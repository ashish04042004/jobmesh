const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectMongo(uri, logger, options = {}) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    ...options,
  });
  logger?.info({ db: mongoose.connection.name }, 'Connected to MongoDB');
  return mongoose.connection;
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

module.exports = { mongoose, connectMongo, disconnectMongo };
