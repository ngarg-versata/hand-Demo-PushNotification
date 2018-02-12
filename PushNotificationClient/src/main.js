define([
	"dojox/app/main", 
	"dojox/json/ref",
	"dojo/text!./config.json",
	"src/app/shared/mdo",
	"src/app/views/pushNotification"
	], function(dojoxMain, json, configJson, mdo, pushNotification) {
			var config = json.fromJson(configJson);
			dojoxMain(config);
			console.log("Starting with mdo uninstall");
			mdo.uninstall().then(function(){
				console.log("Starting with mdo register device");
				return mdo.registerDevice("ipad");
			}).then(function(){
				console.log("Starting with open connection");
				mdo.openConnection();
			}).then(function(){
				console.log("Register event");
				document.addEventListener('deviceready', pushNotification.setupPushNotifications, false);
				console.log("Done with registering event");
			}).then(null, function(error){
				console.log(error);
			});				
	});