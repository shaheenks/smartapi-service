const APP = process.env.APP || 'SMARTS';
const DEFAULT_CHANNEL = process.env.DEFAULT_CHANNEL || 'smartapi-events';
const AMQP_URI = process.env.AMQP_URI || 'amqp://localhost:5672';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';

const amqplib = require('amqplib');
const axios = require('axios');
const { MongoClient } = require('mongodb')  ;

class SmartApiService {
    mqo;
    dbo;

    headerDefaults = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '192.168.29.152',
        'X-ClientPublicIP': '49.37.227.89',
        'X-MACAddress': 'E0:D5:5E:BB:54:E0',
        'X-PrivateKey': 'BZcFZfgh'
    }

    constructor() {
        amqplib.connect(AMQP_URI)
            .then(conn => {
                this.mqo = conn;
                console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS AMQPU mq connected`);

                conn.createChannel()
                    .then(ch => {
                        ch.assertQueue(DEFAULT_CHANNEL);
                        ch.prefetch(1);
                        ch.consume(DEFAULT_CHANNEL, (msg) => {
                            if (msg !== null) {
                                let msgObj = JSON.parse(msg.content.toString());
                                console.log(`${new Date().toISOString()} DEBUG ${APP} SMARTS AMQPU ${JSON.stringify(msgObj)}`);
                                this.dispatchEvent(msgObj, (flag) => {
                                    if (flag) ch.ack(msg)
                                    else ch.ack(msg)
                                })
                            } else {
                                console.log(`${new Date().toISOString()} WARN_ ${APP} SMARTS AMQPU message error`);
                            }
                        })
                    })
                    .catch(err => console.log(`${new Date().toISOString()} WARN_ ${APP} SMARTS AMQPU channel error`))
                return null;
            })
            .then(() => MongoClient.connect(MONGO_URI))
            .then(client => {
                console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS MONGO db connected`);
                this.dbo = client.db("horizons")
            })
            .catch(err => {
                console.log(err)
                console.log(`${new Date().toISOString()} TRACE_ ${APP} SMARTS AMQPU bootstrap error`)
            })

    };

    dispatchEvent(event, callback) {
        let verifyPayload;
        switch (event.action) {
            case 'login':
                verifyPayload = event.inputs.hasOwnProperty("clientcode") && 
                                event.inputs.hasOwnProperty("password") && 
                                    event.inputs.hasOwnProperty("totp");
                if (verifyPayload) this.login(event, flag => callback(flag))
                else callback(false)

                break;
            case 'refresh':
                verifyPayload = event.hasOwnProperty("clientcode");
                if (verifyPayload) this.refresh(event, flag => callback(flag))
                else callback(false)

                break;
            case 'profile':
                verifyPayload = event.hasOwnProperty("clientcode");
                if (verifyPayload) this.profile(event, flag => callback(flag))
                else callback(false)

                break;
            default:
                console.log(`${new Date().toISOString()} WARN_ ${APP} SMARTA DISPA ${event.action} not found`);
                callback(true);
        }
    };

    login(event, callback) {
        let apiResponse = {}
        axios({
            method: 'post',
            url: 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
            headers: {
                ...this.headerDefaults
            },
            data: JSON.stringify(event.inputs)
        })
        .then(response => {
            apiResponse = response.data;

            if (response.data.status == true) console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS LOGIN login success ${JSON.stringify(response.data)}`);
            else console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS LOGIN login failed`);
    
            return this.dbo.collection("events").updateOne(
                { "uuid": event.uuid, "source": event.source },
                { "$set": { "response": apiResponse } },
                { upsert: true }
            )
        })
        .then((result) => {
            if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} SMARTS LOGIN event update failed`);

            return this.dbo.collection("smartApiUserData").replaceOne(
                { 'clientcode': event.clientcode, 'item': 'auth' }, 
                { 'clientcode': event.clientcode, 'item': 'auth', 'data': apiResponse.data },
                { upsert: true }
            )
        })
        .then(result => {
            if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} SMARTS LOGIN user-data update failed`);

            callback(result.acknowledged);
        })
        .catch(error => {
            console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS LOGIN failed ${error}`);
            callback(false)
        })
    }

    refresh(event, callback) {
        let dbAuthObj = {};
        let authObj = {};
        this.dbo.collection("smartApiUserData").findOne({'clientcode': event.clientcode, 'item': 'auth'})
            .then(result => {
                console.log(`[INFO_] ${new Date().toISOString()} ${APP} SMARTS REFRE auth check ${JSON.stringify(result)}`);
                dbAuthObj = result;
                result.data != null ? 
                    authObj = dbAuthObj : 
                    authObj = { clientcode: dbAuthObj.clientcode, data: { jwtToken: null, refreshToken: null }}
                return(null)
            })
            .then(() => {
                return axios({
                    method: 'post',
                    url: 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/jwt/v1/generateTokens',
                    headers: {
                        ...this.headerDefaults,
                        'Authorization': `Bearer ${authObj.data.jwtToken}`
                    },
                    data: JSON.stringify({
                        refreshToken: authObj.data.refreshToken
                    })
                })
            })
            .then(response => {
                if (response.data.status == true) console.log(`${new Date().toISOString()} INFO_ ${APP} EVENTS REFRE refresh success ${JSON.stringify(response.data)}`)
                else console.log(`${new Date().toISOString()} INFO_ ${APP} EVENTS REFRE refresh failed`);
                
                authObj = response.data;
                return this.dbo.collection("events").updateOne(
                    { "uuid": event.uuid, "source": event.source },
                    { "$set": { "response": authObj } },
                    { upsert: true }
                )
            })
            .then((result) => {
                if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} EVENTS REFRE event update failed`);

                return this.dbo.collection("smartApiUserData").replaceOne(
                    { 'clientcode': event.clientcode, 'item': 'auth' }, 
                    { 'clientcode': event.clientcode,'item': 'auth', 'data':  authObj.data},
                    { upsert: true }
                )
            })
            .then(result => {
                if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} EVENTS REFRE user-data update failed`);

                callback(result.acknowledged);
            })
            .catch(error => {
                console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS REFRE refresh failed`)
                callback(false)
            })
    }

    profile(event, callback) {
        let dbAuthObj = {}
        let responseObj = {}
        this.dbo.collection("smartApiUserData").findOne({'clientcode': event.clientcode, 'item': 'auth'})
            .then(result => {
                console.log(`[INFO_] ${new Date().toISOString()} ${APP} SMARTS REFRE auth check ${JSON.stringify(result)}`);
                result.data != null ? 
                    dbAuthObj = result : 
                    dbAuthObj = { clientcode: result.clientcode, data: { jwtToken: null, refreshToken: null }}
                return(null)
            })
            .then(() => {
                return axios({
                    method: 'get',
                    url: 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/user/v1/getProfile',
                    headers: {
                        ...this.headerDefaults,
                        'Authorization': `Bearer ${dbAuthObj.data.jwtToken}`
                    }
                })
            })
            .then(response => {
                if (response.data.status == true) console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS PROFI profile success ${JSON.stringify(response.data)}`);
                else console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS PROFI profile failed`);

                responseObj = response.data
                return this.dbo.collection("events").updateOne(
                    { "uuid": event.uuid, "source": event.source },
                    { "$set": { "response": response.data } },
                    { upsert: true }
                )
            })
            .then(result => {
                if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} EVENTS PROFI event update failed`);

                return this.dbo.collection("smartApiUserData").replaceOne(
                    { 'clientcode': event.clientcode, 'item': 'profile' }, 
                    { 'clientcode': event.clientcode,'item': 'profile', 'data':  responseObj},
                    { upsert: true }
                )
            })
            .then(result => {
                if (!result.acknowledged) console.log(`[INFO_] ${new Date().toISOString()} ${APP} EVENTS PROFI user-data update failed`);

                callback(result.acknowledged);
            })
            .catch(error => {
                console.log(error)
                console.log(`${new Date().toISOString()} INFO_ ${APP} SMARTS PROFI profile failed ${error}`)
                callback(false)
            })
    }

}

module.exports = {
    SmartApiService
}