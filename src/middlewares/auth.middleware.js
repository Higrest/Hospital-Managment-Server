import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const authMiddleware = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const userRes = await pool.query(
        'SELECT id, full_name as "fullName", email, role FROM users WHERE id = $1',
        [decoded.id]
      );

      if (userRes.rows.length === 0) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // ЖЕСТКИЙ ФИКС: записываем в req.user конкретный объект, а не массив рядов
      req.user = userRes.rows[0]; 
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};
