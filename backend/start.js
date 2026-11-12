#!/usr/bin/env node

/**
 * START SCRIPT FOR RENDER DEPLOYMENT
 * Handles database setup and seeding before starting the server
 */

const { execSync } = require('child_process');
const path = require('path');

// Load dotenv only in non-production environments (local development)
// This prevents the local .env file from overriding Render's DATABASE_URL
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

async function setupDatabase() {
  console.log('🔧 Setting up database...');

  // Push schema to database (creates tables if they don't exist)
  try {
    console.log('📦 Running prisma db push...');
    execSync('npx prisma db push', {
      stdio: 'inherit',
      cwd: __dirname
    });
    console.log('✅ Database schema pushed successfully');
  } catch (error) {
    console.error('❌ Prisma db push failed:', error.message);
    process.exit(1);
  }
}

async function seedDatabase() {
  console.log('🌱 Running seed script...');

  try {
    // Clear require cache to get fresh module
    delete require.cache[require.resolve('./seed.js')];
    const seedModule = require('./seed.js');

    if (seedModule.main) {
      await seedModule.main();
    }
    console.log('✅ Seeding completed');
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    // Continue even if seeding fails - database might already have data
  }
}

async function startServer() {
  console.log('🚀 Starting server...');
  // index.js starts the server automatically when required
  require('./index.js');
}

async function main() {
  console.log('====================================');
  console.log('  Virtual Classroom - Render Startup');
  console.log('====================================\n');

  await setupDatabase();
  await seedDatabase();
  await startServer();
}

main().catch(error => {
  console.error('❌ Startup failed:', error);
  process.exit(1);
});