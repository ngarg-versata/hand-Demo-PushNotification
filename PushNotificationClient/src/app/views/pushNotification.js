define(["src/app/shared/mdo",
		"dojo/_base/declare",
		"dijit/_WidgetBase",
		"dijit/_TemplatedMixin", 
		"dijit/_WidgetsInTemplateMixin"], 
	function(mdo) {	
		return {

			setupPushNotifications: function() {
		        mdo.getPushNotificationChannel("PushNotificationTest")
		        .then(function(channel){
			        var push = PushNotification.init({
			            android: { 
			                senderID: channel.ahSenderId,
			                vibrate: true,
			                sound: true
			            },
			            ios: {
	                        alert: true,
	                        badge: true,
	                        sound: true,
	                        vibration: true
			            }
			        });

			        push.on('registration', function(data) {
			            console.log('Device Token: ' + data.registrationId);
			            var platform;
			            switch(device.platform.toLowerCase()) {
			                case 'android': platform = 'Google'; break;
			                case 'ios':     platform = 'Apple';  break;
			                default:
		                        console.error('Cannot run push notifications on unsupported device');
		                        return;
			            };

			            mdo.getDevice("ipad")
			            .then(function(myDevice){
			            	myDevice.ahPushNotificationPlatform = platform;
				            myDevice.ahPushNotificationDeviceId = data.registrationId;
				            myDevice.save();
				            mdo.sync();
			            });  
			        });

			        push.on('notification', function(data) {
			            console.log('Received Notification!');
			            console.log(data);
			        });

			        push.on('error', function(err) {
			                console.error('Error Receiving Notification');
			            console.error(err);
			        });
			    });
		    }			
		}
});