import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { register, login } from './controllers/auth.controller.js';
import { getDoctors, addDoctor } from './controllers/doctor.controller.js';
import { 
  getAvailableSlots, 
  createAppointment, 
  getPatientDashboard, 
  getDoctorDashboard, 
  getAdminStats, 
  updateAppointmentStatus, 
  getAllAppointmentsForReceptionist,
  getCalendarAppointments 
} from './controllers/appointment.controller.js';
import { authMiddleware } from './middlewares/auth.middleware.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Маршруты авторизации
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

// Маршруты врачей и записей
app.get('/api/doctors', authMiddleware, getDoctors);
app.get('/api/appointments/slots', authMiddleware, getAvailableSlots);
app.post('/api/appointments', authMiddleware, createAppointment);

// Маршруты дашбордов и администрирования
app.get('/api/patient/appointments', authMiddleware, getPatientDashboard);
app.get('/api/doctor/appointments', authMiddleware, getDoctorDashboard);
app.get('/api/admin/stats', authMiddleware, getAdminStats);
app.get('/api/admin/doctors', authMiddleware, getDoctors);
app.post('/api/admin/doctors', authMiddleware, addDoctor);

// Маршруты для Регистратора (Списки и Календарь)
app.get('/api/receptionist/appointments', authMiddleware, getAllAppointmentsForReceptionist);
app.get('/api/receptionist/calendar', authMiddleware, getCalendarAppointments);

// Маршруты обновления статуса приёмов
app.patch('/api/appointments/:id/status', authMiddleware, updateAppointmentStatus);
app.put('/api/appointments/:id/status', authMiddleware, updateAppointmentStatus);

app.use(errorMiddleware);

export default app;
