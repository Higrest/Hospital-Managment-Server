import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

delete process.env.DATABASE_URL;

const pool = new pg.Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10), // Жестко используем стандартный порт пулера сессий
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

const seedDatabase = async () => {
  try {
    console.log('Starting database seeding...');

    // 1. Очистка старых данных (каскадно)
    await pool.query('TRUNCATE appointments, doctors, patients, departments, users RESTART IDENTITY CASCADE');

    // 2. Создание отделений клиники
    const deptRes = await pool.query(`
      INSERT INTO departments (name) VALUES 
      ('Cardiology'), 
      ('Neurology'), 
      ('Pediatrics'), 
      ('Surgery') 
      RETURNING id, name
    `);
    const depts = deptRes.rows;
    console.log('Created departments:', depts.map(d => d.name));

    // Хэшируем общий пароль для всех тестовых аккаунтов
    const salt = await bcrypt.genSalt(10);
    const defaultPasswordHash = await bcrypt.hash('password123', salt);

    // 3. Создание пользователя-Врача
    const doctorUser = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (\$1, \$2, \$3, 'Doctor') RETURNING id",
      ['Dr. John Doe', 'doctor@clinic.com', defaultPasswordHash]
    );

    // 4. Привязка пользователя к таблице врачей (Кардиология)
    const cardioId = depts.find(d => d.name === 'Cardiology').id;
    await pool.query(
      "INSERT INTO doctors (user_id, department_id, specialization) VALUES (\$1, \$2, 'Invasive Cardiology')",
      [doctorUser.rows[0].id, cardioId]
    );

    // 5. Создание пользователя-Пациента
    const patientUser = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (\$1, \$2, \$3, 'Patient') RETURNING id",
      ['Muhammadbobur Egamberdiyev', 'patient@clinic.com', defaultPasswordHash]
    );

    // 6. Привязка пользователя к таблице пациентов
    await pool.query(
      "INSERT INTO patients (user_id, blood_type, allergies) VALUES (\$1, 'O+', 'Penicillin')",
      [patientUser.rows[0].id]
    );

    // 7. Создание администратора
    await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (\$1, \$2, \$3, 'Admin')",
      ['System Administrator', 'admin@clinic.com', defaultPasswordHash]
    );

    // 8. Создание регистратора (Рецепшен)
    await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (\$1, \$2, \$3, 'Receptionist')",
      ['Clinic Receptionist', 'receptionist@clinic.com', defaultPasswordHash]
    );

    console.log('Successfully seeded database!');
    console.log('Test Accounts (Password for all: password123):');
    console.log(' - Admin: admin@clinic.com');
    console.log(' - Doctor: doctor@clinic.com');
    console.log(' - Patient: patient@clinic.com');
    console.log(' - Receptionist: receptionist@clinic.com');

  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await pool.end();
  }
};

seedDatabase();
