const mongoose = require('mongoose');
const dns = require('dns');

// On Windows, Node.js c-ares DNS resolver can fail on SRV records with ISP DNS.
// Setting public DNS ensures MongoDB Atlas (mongodb+srv) connects reliably.
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {
  // Ignore if cannot set
}

const connectDB = async () => {
  const connUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/brainnova';

  if (!process.env.MONGODB_URI) {
    console.warn('\n[Note] MONGODB_URI is not set in server/.env.');
    console.warn('Attempting to connect to default local MongoDB: mongodb://127.0.0.1:27017/brainnova\n');
  }

  try {
    const conn = await mongoose.connect(connUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`✅ MongoDB Connected successfully: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Failed: ${error.message}`);
    console.error('If using MongoDB Atlas (cloud), verify your connection string in NoteMindAi/server/.env');
  }
};

module.exports = connectDB;
