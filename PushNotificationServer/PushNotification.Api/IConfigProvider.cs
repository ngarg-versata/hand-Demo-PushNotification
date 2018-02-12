namespace PushNotification.Api
{
	public interface IConfigProvider : IDataConfigProvider
	{
		string AuthDomain { get; }
		string AuthType { get; }
		string PushNotificationChannel { get; }
		string PushNotificationApiKey { get; }
	}
}