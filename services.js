// const { MongoAccess } = require('../mongo')
// let dbo = new MongoAccess();

const validate = require('jsonschema').validate;
const payloadSchema = {
	"type": "object",
	"properties": {
		"system": { "type": "string" },
		"ts": { "type": "string" },
		"action": { "required": true, "type": "string" },
		"payload" : { "required": true, "type": "object"}
	}
};


const dispatchAction = (event, callback) => {

	let validationResult = validate(event, payloadSchema);
	if (validationResult.errors.length == 0) {
		switch (event.action) {
			case "login":
				console.log("/login");
				login(event, (flag, message) => {
					console.log(message);
					callback(flag, message)
				})
				break;
			case "profile":
				console.log("/profile");
				profile(event, (flag, message) => {
					console.log(message);
					callback(flag, message)
				})
				break;
			default:
				console.log("action not found.");
				callback(true, "action not found.")
		}
	} else {
		console.log('validation failure')
		callback(false, "validation failure")
	}
	
};

const axios = require('axios');
const moment = require('moment');
const headerStore = {
	'Content-Type': 'application/json',
	'Accept': 'application/json',
	'X-UserType': 'USER',
	'X-SourceID': 'WEB',
	'X-ClientLocalIP': '192.168.29.152',
	'X-ClientPublicIP': '49.37.227.89',
	'X-MACAddress': 'E0:D5:5E:BB:54:E0',
	'X-PrivateKey': 'BZcFZfgh'
};

const { MongoAccess } = require("../utils/mongo");
var dbo = new MongoAccess();

const login = (event, callback) => {
    console.log(`${moment().format()} [login] request received.`)
    let payload = {
        "clientcode": event.payload.clientcode,
        "password": event.payload.password,
        "totp": event.payload.totp
    };
	let authObject = {};

    loginByPassword(payload, headerStore)
        .then((response) => {
            if (response.data.status == false) {
				authObject = response.data;
                callback(false, `${moment().format()} [login] auth failure`)
            } else {
                // authResponse = response.data;
                return dbo.getDb().collection('smartapi').replaceOne({'item': 'auth', 'clientcode': payload.clientcode }, { item: 'auth', 'clientcode': payload.clientcode, ...response.data }, {upsert: true})
            }
        })
        .then(result => {
            callback(true, authObject)
        })
        .catch((error) => {
            callback(false, `${moment().format()} [login] error in processing`)
        });
};

const loginByPassword = (payload, headers) => {
    return axios({
        method: 'post',
        url: 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
        headers: {
            ...headers
        },
        data: JSON.stringify(payload)
    });
};

const profile = (event, callback) => {
    console.log(`${moment().format()} [profile] request received`)
	dbo.collection("smartapi").findOne({item: "auth", clientcode: "s90725"})
		.then(authObject => {
			return getProfile({}, headerStore, authObject)
		})
        .then((response) => {
            console.log(`${moment().format()} [profile] response sent`)
            callback(true, response.data)
        })
        .catch((error) => {
            callback(false, `${moment().format()} [profile] error in processing`)
        })
};

const getProfile = (payload, headers, authObject) => {
    return axios({
        method: 'get',
        url: 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/user/v1/getProfile',
        headers: {
            ...headers,
            'Authorization': `Bearer ${authObject.data.jwtToken}`
        }
    });
};

module.exports = {
	dispatchAction,

	login,
	profile
}