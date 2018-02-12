namespace PushNotification.Api
{
	public interface IDataConfigProvider
	{
		string MTierContext { get; }
		string MTierSessionPrefix { get; }
		string ServiceRepositoryType { get; }
		string ServiceRepositoryConnection { get; }
		string AnalyticsModelPath { get; }
	}
}