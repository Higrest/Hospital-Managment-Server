import app from './src/app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5089;

app.listen(PORT, () => {
  console.log(`Hospital Management server running on port ${PORT}`);
});
