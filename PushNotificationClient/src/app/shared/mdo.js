define(["mdoApi"], 
	function(MDO) {
			return {

				registerDevice: function(deviceName) {
					var self = this;
					var promise = this._getServiceEndpoint()
						.then(function(serviceEndpoint) {
							return MDO.install(serviceEndpoint, "PushNotificationPoc", deviceName, "");
						});
					return promise;
				},

				uninstall: function(){
					var self = this;
					var promise = MDO.uninstall();
					return promise.then(function() {
						self.connection = undefined;
					});
				},

				_getServiceEndpoint: function() {
					var serviceEndpoint = "/MTierData/";
					if (!/https?:/i.test(location.protocol)) {
						if (this.serverUrl === "") {
							//Running in windows 8.1 platform and no serverUrl in the ah.json
							return MDO.reject(new Error("No Data Service URL has been specified."));
						} else {
							return MDO.resolve(this.serverUrl);
						}
					} else {
						return MDO.resolve(serviceEndpoint);
					}
				},

				openConnection: function() {
					if(!this.connection) {
						this.connection = MDO.createConnection();
						this.connection.open();
					}
					return this.connection;
				},

				closeConnection: function() {
					if(this.connection) {
						this.connection.close();
					}
				},

				getPushNotificationChannel: function(channelName) {
					var channel = this.connection.createElement("AH_PushNotificationChannel");
					channel.ahChannel = channelName;
					return channel.resolve();
				},

				getDevice: function(deviceName) {
					var device = this.connection.createElement("AH_Device");
					device.ahSerialNum = deviceName;
					return device.resolve();
				},

				sync: function(options) {
					var self = this;
					var promise = self.connection.sync(options);				
				}
		}
});