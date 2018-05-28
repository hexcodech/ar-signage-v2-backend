const Express = require('express');
const Mqtt = require('mqtt');
const Jsonfile = require('jsonfile');
const jsonFilePath = './clients.json';
const config = require('./config.json');

module.exports = class App {
    constructor() {
        this.mqtt = Mqtt.connect(config.mqttServer);
        this.mqttEvents();

        this.express = Express();
        this.routes();
        this.express.listen(config.bindingPort, config.bindingIP, () => console.log('HTTP Server listening on port 3000'));
    }

    routes() {
        this.express.use('/mediaCache', Express.static(__dirname + '/media'));
    }

    mqttEvents() {
        this.mqtt.on('connect', () => {
            this.mqtt.subscribe(`ar-signage/devicediscovery`);
        });

        this.mqtt.on('error', () => {
            console.error('Mqtt error');
        });

        this.mqtt.on('message', (topic, message) => this.mqttMessageHandler(topic, message));
    }

    mqttMessageHandler(topic, message) {
        let messageObject;
        try {
            messageObject = JSON.parse(message.toString());
        } catch (err) {
            console.error(`mqttMessageHandler JSON parse error: ${err.toString()}`);
        }

        switch (topic) {
            case `ar-signage/devicediscovery`:
                if (messageObject.value.uuid) {
                    Jsonfile.readFile(jsonFilePath, (err, obj) => {
                        if (obj[messageObject.value.uuid] && obj[messageObject.value.uuid].roomname) {
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/roomname`, JSON.stringify({
                                value: obj[messageObject.value.uuid].roomname
                            }), {retain: true});
                            this.mqtt.publish(`ar-signage/client/${messageObject.value.uuid}/mediacacheurl`, JSON.stringify({
                                value: `${config.bindingIP}:${config.bindingPort}/mediaCache`
                            }), {retain: true});
                        }
                    });
                }
                break;
        }
    }
}