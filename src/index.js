require('dotenv').config();
const APP_NAME = process.env.APP || 'DEFAULT';

const { SmartApiService } = require('./smart-api');
const smartApiService = new SmartApiService();

console.log(`${new Date().toISOString()} INFO_ ${APP_NAME} SYSTEM INDEX service started`)