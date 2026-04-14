import { initializeDatabase } from './database.js';

console.log('Starting database initialization...');

try {
  await initializeDatabase();
  console.log('Database setup completed successfully!');
} catch (error) {
  console.error('Database setup failed:', error);
  process.exit(1);
}