const Express = require('express');
const Mqtt = require('mqtt');
const Jsonfile = require('jsonfile');
const Cors = require('cors');
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
        this.express.use(Cors());
        this.express.use('/mediaCache', Express.static(__dirname + '/media'));
        this.express.use('/rooms', Express.static(__dirname + '/rooms.json'));
        this.express.use('/clients', Express.static(__dirname + '/clients.json'));
    }

    mqttEvents() {
        this.mqtt.on('connect', () => {
            console.log(`--- Connected to mqtt server! Subscribing to topics`);
            this.mqtt.subscribe(`ar-signage/devicediscovery`);
            this.mqtt.subscribe(`ar-signage/+/timer/setseconds`);
            this.mqtt.subscribe(`ar-signage/+/timer/control`);
        });

        this.mqtt.on('error', () => {
            console.error('Mqtt error');
        });

        console.log(`--- Registering mqtt message handler`);
        this.mqtt.on('message', (topic, message) => this.mqttMessageHandler(topic, message));
    }

    mqttMessageHandler(topic, message) {
        let messageObject;
        let roomname;
        try {
            messageObject = JSON.parse(message.toString());
        } catch (err) {
            console.error(`mqttMessageHandler JSON parse error: ${err.toString()}`);
        }
        console.log(topic);
        console.dir(messageObject);
        console.log();
        // Abusing switch for regex matching... This is sooo evil and genius I love it :P
        switch (true) {
            case topic === 'ar-signage/devicediscovery':
                if (messageObject.value.uuid && messageObject.value.role === 'client') {
                    this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/mediacacheurl`, JSON.stringify({
                        value: `http://${config.bindingIP}:${config.bindingPort}/mediaCache`
                    }));

                    Jsonfile.readFile(clientsJsonFilePath, (err, obj) => {
                        if (obj[messageObject.value.uuid] && obj[messageObject.value.uuid].roomname && obj[messageObject.value.uuid].clientname) {
                            console.log(`- Defined client ${obj[messageObject.value.uuid].clientname} (${messageObject.value.uuid}) discovered!`);
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/roomname`, JSON.stringify({
                                value: obj[messageObject.value.uuid].roomname
                            }));
                        } else {
                            console.log(`- Undefined client ${messageObject.value.uuid} discovered! Adding template entry to clients.json`);
                            obj[messageObject.value.uuid] = {};
                            obj[messageObject.value.uuid].roomname = 'default';
                            obj[messageObject.value.uuid].clientname = 'undefinedClient' + Math.floor(Math.random()*10000);
                            Jsonfile.writeFile(clientsJsonFilePath, obj, {spaces: 2}, (err) => {
                                if (err)
                                    console.error(`Error creating empty client object in json: ${err}`);
                            });
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/roomname`, JSON.stringify({
                                value: obj[messageObject.value.uuid].roomname
                            }));
                        }
                    });
                } else if (messageObject.value.role === 'dashboard') {
                    this.mqtt.publish(`ar-signage/dashboard/mediacacheurl`, JSON.stringify({
                        value: `http://${config.bindingIP}:${config.bindingPort}/mediaCache`
                    }));
                    this.mqtt.publish(`ar-signage/dashboard/roomsurl`, JSON.stringify({
                        value: `http://${config.bindingIP}:${config.bindingPort}/rooms`
                    }));
                    this.mqtt.publish(`ar-signage/dashboard/clientsurl`, JSON.stringify({
                        value: `http://${config.bindingIP}:${config.bindingPort}/clients`
                    }));
                }
                break;
            case topic.match(/^ar-signage\/.+\/timer\/setseconds$/g) && topic.match(/^ar-signage\/.+\/timer\/setseconds$/g).length > 0:
                roomname = topic.split(/[\/\/]/g)[1];
                const value = parseInt(messageObject.value, 10);
                this.timers[roomname].originalSeconds = value;
                this.timers[roomname].seconds = value;
                this.mqtt.publish(`ar-signage/${roomname}/timer/seconds`, JSON.stringify({
                    value: this.timers[roomname].seconds
                }), {retain: true});
                break;
            case topic.match(/^ar-signage\/.+\/timer\/control$/g) && topic.match(/^ar-signage\/.+\/timer\/control$/g).length > 0:
                roomname = topic.split(/[\/\/]/g)[1];
                switch (messageObject.value) {
                    case 'START':
                        if (this.timers[roomname].seconds > 0) {
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
                    case 'RESET':
                        this.timers[roomname].seconds = this.timers[roomname].originalSeconds;
                        if (this.timers[roomname].interval) {
                            clearInterval(this.timers[roomname].interval);
                        }
                        this.mqtt.publish(`ar-signage/${roomname}/timer/seconds`, JSON.stringify({
                            value: this.timers[roomname].seconds
                        }), {retain: true});
                        break;
                    case 'PAUSE':
                        if (this.timers[roomname].interval) {
                            clearInterval(this.timers[roomname].interval);
                        }
                        break;
                }
                break;
        }
    }
}