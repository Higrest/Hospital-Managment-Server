import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

// 1. Получение списка всех врачей для таблицы
export const getDoctors = async (req, res) => {
  try {
    const query = `
      SELECT d.id, u.full_name as name, de.name as department, d.specialization
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      JOIN departments de ON d.department_id = de.id
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get Doctors Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// 2. Добавление нового врача с УНИКАЛЬНЫМИ именем, почтой и паролем
export const addDoctor = async (req, res) => {
  const { fullName, email, password, departmentId, specialization } = req.body;

  if (!fullName || !email || !password || !departmentId || !specialization) {
    return res.status(400).json({ message: 'Все поля формы обязательны для заполнения' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем, не занята ли эта почта кем-то другим
    const userExists = await client.query('SELECT id FROM users WHERE email = \$1', [email]);
    if (userExists.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Пользователь с таким Email уже существует' });
    }

    // Хэшируем персональный пароль конкретного врача
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Вставляем запись в таблицу пользователей (users) с ролью 'Doctor'
    const userRes = await client.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (\$1, \$2, \$3, 'Doctor') RETURNING id",
      [fullName, email, passwordHash]
    );
    const userId = userRes.rows[0].id;

    // Привязываем созданного пользователя к таблице врачей (doctors)
    await client.query(
      "INSERT INTO doctors (user_id, department_id, specialization) VALUES (\$1, \$2, \$3) RETURNING id",
      [userId, parseInt(departmentId, 10), specialization]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Врач успешно зарегистрирован',
      email: email,
      fullName: fullName
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add Doctor Error:', error);
    res.status(500).json({ message: 'Ошибка сервера при добавлении врача' });
  } finally {
    client.release();
  }
};
