import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Очищаем старую переменную из кэша процессов для стабильности IPv4 сессий в AWS
delete process.env.DATABASE_URL;

const pool = new pg.Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

// 1. Получение свободных слотов для записи к врачу
export const getAvailableSlots = async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) {
    return res.status(400).json({ message: 'Идентификатор врача и дата обязательны' });
  }

  try {
    const defaultSlots = [
      { time: '09:00:00', booked: false },
      { time: '10:00:00', booked: false },
      { time: '11:00:00', booked: false },
      { time: '14:00:00', booked: false },
      { time: '15:00:00', booked: false }
    ];

    const bookedSlotsRes = await pool.query(
      "SELECT appointment_time FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND status IN ('Waiting', 'Confirmed')",
      [doctorId, date]
    );

    const bookedTimes = bookedSlotsRes.rows.map(row => row.appointment_time);
    const activeSlots = defaultSlots.map(slot => ({
      time: slot.time.substring(0, 5),
      booked: bookedTimes.includes(slot.time)
    }));

    res.status(200).json(activeSlots);
  } catch (error) {
    console.error('Ошибка получения slots:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 2. Создание новой записи (Защита от Double Booking через FOR UPDATE)
export const createAppointment = async (req, res) => {
  const { doctorId, date, time } = req.body;

  const currentUser = Array.isArray(req.user) ? req.user[0] : req.user;
  const userId = currentUser?.id;

  if (!doctorId || !date || !time || !userId) {
    return res.status(400).json({ message: 'Все поля и авторизация обязательны' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    const patientRes = await client.query('SELECT id FROM patients WHERE user_id = $1', [userId]);
    if (patientRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Карточка пациента не найдена' });
    }
    const patientId = patientRes.rows[0].id;

    const checkSlotRes = await client.query(
      "SELECT id FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status IN ('Waiting', 'Confirmed') FOR UPDATE",
      [doctorId, date, time]
    );

    if (checkSlotRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Этот слот времени у врача уже занят!' });
    }

    await client.query(
      "INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, $4, 'Waiting')",
      [patientId, doctorId, date, time]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Запись успешно создана' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Этот слот времени у врача уже занят!' });
    }
    console.error('Ошибка создания записи:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  } finally {
    client.release();
  }
};

// 3. Получение данных дашборда Пациента
export const getPatientDashboard = async (req, res) => {
  try {
    const currentUser = Array.isArray(req.user) ? req.user[0] : req.user;
    const userId = currentUser?.id;

    const patientRes = await pool.query('SELECT id, blood_type, allergies FROM patients WHERE user_id = $1', [userId]);
    if (patientRes.rows.length === 0) {
      return res.status(404).json({ message: 'Профиль пациента не найден' });
    }
    const patient = patientRes.rows[0];

    const appRes = await pool.query(
      `SELECT a.id, u.full_name as "doctorName", a.appointment_date as date, a.appointment_time as time, a.status 
       FROM appointments a 
       JOIN doctors d ON a.doctor_id = d.id 
       JOIN users u ON d.user_id = u.id 
       WHERE a.patient_id = $1 AND a.status IN ('Waiting', 'Confirmed') ORDER BY a.appointment_date DESC`,
      [patient.id]
    );

    const historyRes = await pool.query(
      `SELECT mr.id, mr.diagnosis, mr.prescription, a.appointment_date as date, u.full_name as "doctorName"
       FROM medical_records mr
       JOIN appointments a ON mr.appointment_id = a.id
       JOIN doctors d ON a.doctor_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE a.patient_id = $1 ORDER BY a.appointment_date DESC`,
      [patient.id]
    );

    res.status(200).json({
      appointments: appRes.rows || [],
      profile: {
        bloodType: patient.blood_type || 'N/A',
        blood_type: patient.blood_type || 'N/A',
        allergies: patient.allergies || 'Нет'
      },
      medicalHistory: historyRes.rows || []
    });
  } catch (error) {
    console.error('Ошибка дашборда пациента:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 4. Получение данных дашборда Врача
export const getDoctorDashboard = async (req, res) => {
  try {
    const currentUser = Array.isArray(req.user) ? req.user[0] : req.user;
    const userId = currentUser?.id;

    const docRes = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [userId]);
    if (docRes.rows.length === 0) {
      return res.status(404).json({ message: 'Запись врача не найдена' });
    }
    const doctorId = docRes.rows[0].id;

    const appRes = await pool.query(
      `SELECT a.id, u.full_name as "patientName", a.appointment_date as date, a.appointment_time as time, a.status 
       FROM appointments a 
       JOIN patients p ON a.patient_id = p.id 
       JOIN users u ON p.user_id = u.id 
       WHERE a.doctor_id = $1 ORDER BY a.appointment_date DESC, a.appointment_time ASC`,
      [doctorId]
    );
    res.status(200).json(appRes.rows);
  } catch (error) {
    console.error('Ошибка дашборда врача:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 5. Получение статистики для Администратора
export const getAdminStats = async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM patients)::text as "totalPatients",
        (SELECT COUNT(*) FROM appointments WHERE status = 'Waiting')::text as "activeSlots",
        (SELECT COUNT(*) FROM appointments WHERE status = 'Completed')::text as "completed",
        (SELECT COUNT(*) FROM appointments WHERE status = 'Cancelled')::text as "cancelled"
    `;
    const statsRes = await pool.query(statsQuery);
    res.status(200).json(statsRes.rows[0]);
  } catch (error) {
    console.error('Ошибка статистики админа:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 6. Обновление статуса записи (Подтверждение/Отмена) врачом или регистратором
export const updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['Waiting', 'Confirmed', 'Completed', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Некорректный статус приёма' });
  }

  try {
    const result = await pool.query(
      'UPDATE appointments SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Запись не найдена' });
    }

    res.status(200).json({ message: `Статус записи успешно изменен на ${status}`, appointment: result.rows });
  } catch (error) {
    console.error('Ошибка изменения статуса записи:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 7. Получение списка ВСЕХ записей клиники для Регистратора (Таблица)
export const getAllAppointmentsForReceptionist = async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        u_p.full_name as "patientName",
        u_d.full_name as "doctorName",
        a.appointment_date as date,
        a.appointment_time as time,
        a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u_p ON p.user_id = u_p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users u_d ON d.user_id = u_d.id
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Ошибка получения записей регистратором:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 8. Получение записей для сетки календаря Регистратора
export const getCalendarAppointments = async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id,
        u_p.full_name as title,
        u_d.full_name as "doctorName",
        a.appointment_date as date,
        a.appointment_time as time,
        a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u_p ON p.user_id = u_p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users u_d ON d.user_id = u_d.id
      WHERE a.status IN ('Waiting', 'Confirmed')
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Ошибка календаря:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// 9. Добавление медицинского заключения (Диагноз + Рецепт) врачом
export const addMedicalRecord = async (req, res) => {
  const { appointmentId, diagnosis, prescription } = req.body;

  if (!appointmentId || !diagnosis || !prescription) {
    return res.status(400).json({ message: 'Все поля формы обязательны для заполнения' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO medical_records (appointment_id, diagnosis, prescription) VALUES ($1, $2, $3)',
      [appointmentId, diagnosis, prescription]
    );
    await client.query(
      "UPDATE appointments SET status = 'Completed' WHERE id = $1",
      [appointmentId]
    );
    await client.query('COMMIT');
    res.status(201).json({ message: 'Медицинское заключение успешно сохранено, приём завершен' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка добавления медкарты:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  } finally {
    client.release();
  }
};