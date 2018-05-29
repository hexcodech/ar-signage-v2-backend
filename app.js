const Express = require('express');
const Mqtt = require('mqtt');
const Jsonfile = require('jsonfile');
const clientsJsonFilePath = './clients.json';
const roomsJsonFilePath = './rooms.json';
const config = require('./config.json');

module.exports = class App {
    constructor() {
        console.log(`--- Initializing timers`);
        this.initTimers();

        console.log(`--- Trying to connect to mqtt server`);
        this.mqtt = Mqtt.connect(config.mqttServer);
        this.mqttEvents();

        console.log(`--- Initializing express`);
        this.express = Express();
        this.routes();
        this.express.listen(config.bindingPort, config.bindingIP, () => console.log(`--- Express listening on port ${config.bindingPort}`));
    }

    initTimers() {
        this.timers = {};

        Jsonfile.readFile(roomsJsonFilePath, (err, obj) => {
            if (!obj) {
                console.error(`rooms.json is empty or doesn't exist`);
                return;
            }
            obj.forEach(roomname => {
                this.timers[roomname] = {};
                this.timers[roomname].interval = null;
                this.timers[roomname].seconds = 0;
                this.timers[roomname].originalSeconds = 0;
            });
        });
    }

    routes() {
        console.log(`--- Registering routes & middlewares`);
        this.express.use('/mediaCache', Express.static(__dirname + '/media'));
    }

    mqttEvents() {
        this.mqtt.on('connect', () => {
            console.log(`--- Connected to mqtt server! Subscribing to topics`);
            this.mqtt.subscribe(`ar-signage/devicediscovery`);
        });

        this.mqtt.on('error', () => {
            console.error('Mqtt error');
        });

        console.log(`--- Registering mqtt message handler`);
        this.mqtt.on('message', (topic, message) => this.mqttMessageHandler(topic, message));
    }

    mqttMessageHandler(topic, message) {
        let messageObject;
        try {
            messageObject = JSON.parse(message.toString());
        } catch (err) {
            console.error(`mqttMessageHandler JSON parse error: ${err.toString()}`);
        }

        // Abusing switch for regex matching... This is sooo evil and genius I love it :P
        switch (true) {
            case topic === 'ar-signage/devicediscovery':
                if (messageObject.value.uuid) {
                    this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/mediacacheurl`, JSON.stringify({
                        value: `${config.bindingIP}:${config.bindingPort}/mediaCache`
                    }), {retain: true});

                    Jsonfile.readFile(clientsJsonFilePath, (err, obj) => {
                        if (obj[messageObject.value.uuid] && obj[messageObject.value.uuid].roomname && obj[messageObject.value.uuid].clientname) {
                            console.log(`- Defined client ${obj[messageObject.value.uuid].clientname} (${messageObject.value.uuid}) discovered!`);
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/roomname`, JSON.stringify({
                                value: obj[messageObject.value.uuid].roomname
                            }), {retain: true});
                        } else {
                            console.log(`- Undefined client ${messageObject.value.uuid} discovered! Adding template entry to clients.json`);
                            obj[messageObject.value.uuid] = {};
                            obj[messageObject.value.uuid].roomname = 'default';
                            obj[messageObject.value.uuid].clientname = 'undefinedClient' + Math.random()*10000;
                            Jsonfile.writeFile(clientsJsonFilePath, obj, (err) => {
                                console.error(`Error creating empty client object in json: ${err}`);
                            });
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/roomname`, JSON.stringify({
                                value: obj[messageObject.value.uuid].roomname
                            }), {retain: true});
                        }
                    });
                }
                break;
            case topic.match(/^ar-signage\/.+\/timer\/setseconds$/g):
                let roomname = topic.split(/[\/\/]/g)[1];
                this.timers[roomname].seconds = messageObject.value;
                break;
            case topic.match(/^ar-signage\/.+\/timer\/control$/g):
                let roomname = topic.split(/[\/\/]/g)[1];
                switch (messageObject.value) {
                    case 'START':
                        if (this.timers[roomname].seconds > 0) {
                            this.timers[roomname].originalSeconds = this.timers[roomname].seconds;

                            if (this.timers[roomname].interval) {
                                clearInterval(this.timers[roomname].interval);
                            }
                            this.timers[roomname].interval = setInterval(() => {
                                this.timers[roomname].seconds--;
                                this.mqtt.publish(`ar-signage/${roomname}/timer/seconds`, JSON.stringify({
                                    value: this.timers[roomname].seconds
                                }), {retain: true});

                                if (this.timers[roomname].seconds <= 0) {
                                    clearInterval(this.timers[roomname].interval);
                                }
                            }, 1000);
                        }
                        break;
                }
                break;
        }
    }
}