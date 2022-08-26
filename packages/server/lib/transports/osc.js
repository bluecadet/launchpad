
import osc from "osc";
import os from "os"

export class OscTransport {

  _launchpadServer;

  _oscServer;

  constructor(launchpadServer) {
    this._launchpadServer = launchpadServer;
  }

  _getIPAddresses() {
    var interfaces = os.networkInterfaces(),
        ipAddresses = [];

    for (var deviceName in interfaces) {
        var addresses = interfaces[deviceName];
        for (var i = 0; i < addresses.length; i++) {
            var addressInfo = addresses[i];
            if (addressInfo.family === "IPv4" && !addressInfo.internal) {
                ipAddresses.push(addressInfo.address);
            }
        }
    }

    return ipAddresses;
  }

  init() {

    this._oscServer = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: 57121
    });

    const transport = this;
    this._oscServer.on("ready", function () {
      var ipAddresses = transport._getIPAddresses();

      console.log("Listening for OSC over UDP.");
      ipAddresses.forEach(function (address) {
          console.log(" Host:", address + ", Port:", transport._oscServer.options.localPort);
      });
    });

    this._oscServer.on("message", function (oscMessage) {
      transport.handleMessages(oscMessage);
    });

    this._oscServer.on("error", function (err) {
      console.log(err);
    });

    this._oscServer.open();
  }

  handleMessages(oscMessage) {
    console.log(oscMessage);


    // TODO: need to figure out how to map these addresses.
    switch (oscMessage.address) {
      case "/syntien/basic/1/button1":

        console.log(oscMessage.args);
        console.log([0, 0]);
        if (oscMessage.args[0] == 0 && oscMessage.args[1] == 0 ) {

          console.log("Updating Content");
          this._launchpadServer.updateContent();
        }
        break;
    }
  }
}
