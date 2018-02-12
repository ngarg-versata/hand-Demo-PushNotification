# hand-Demo-PushNotification

Demo app to send and receive push notifications.

This project includes:
- PushNotificationServer - Server side app uses AtHand.PushNotification nuget package to send push notifications. It calls SendNotification method available in nuget package.
- PushNotificationClient - Client side app to register for push notification.

### Project setup
- GCM/APN and Web Admin Channel
	* Please refer https://confluence.devfactory.com/display/HAND/Recommended+Installation+of+Push+Notifications
- Server app
	* Open solution and enter correct value for Api token and ConfigProvider (Channel) In FunqRegistry.cs.
	* Host the app as 'PushNotificationServer' in IIS.
	* Set domain, database and device accounts. To import data, you can use Saphron or any other customer solution.
	* To send notification, use any Rest client (like Postman) to invoke http://{server_name}/PushNotificationServer/api/PushNotification/Send url.
- Client app
	* Host the app as 'PushNotificationClient' in IIS.
	* Create a spab job for Android Push Notification and enter start page url to be http://{ip_address}/PushNotificationClient. For reference, see 	   https://spab.hand.com/#/application/5a7b2c63c7aa6d6e04b9ce9c.	
	* Download the package and install the apk in Android device.