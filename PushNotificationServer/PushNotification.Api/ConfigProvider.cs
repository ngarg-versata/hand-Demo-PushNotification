using System.Configuration;
using System.IO;

namespace PushNotification.Api
{
	public class ConfigProvider : IConfigProvider
	{
		private readonly string _defaultBasePath;

		public ConfigProvider(string defaultBasePath)
		{
			_defaultBasePath = defaultBasePath;
		}

		private string _mtierContext;
		
		public string MTierContext
		{
			get { return _mtierContext ?? (_mtierContext = GetSetting("mtierContext")); }
		}

		private string _authDomain;

		public string AuthDomain
		{
			get { return _authDomain ?? (_authDomain = GetSetting("userAuthDomain")); }
		}

		private string _authType;

		public string AuthType
		{
			get { return _authType ?? (_authType = GetSetting("userAuthType")); }
		}

		private string _pushNotificationChannel;

		public string PushNotificationChannel
		{
			get { return _pushNotificationChannel ?? (_pushNotificationChannel = GetSetting("pushNotificationChannel")); }
		}

		private string _pushNotificationApiKey;

		public string PushNotificationApiKey
		{
			get { return _pushNotificationApiKey ?? (_pushNotificationApiKey = GetSetting("pushNotificationApiKey")); }
		}

		public string MTierSessionPrefix
		{
			get { return "AtHand.Saphron"; }
		}

		public string ServiceRepositoryType
		{
			get { return "Sqlite"; }
		}

		public string ServiceRepositoryConnection
		{
			get { return null; }
		}

		private string _analyticsModelPath = "";

		public string AnalyticsModelPath
		{
			get { return _analyticsModelPath; }
		}

		protected string GetSetting(string name, string defaultValue = null)
		{
			return ConfigurationManager.AppSettings[name] ?? defaultValue;
		}

		protected string ResolveRelativeDirectory(string relativePath)
		{
			return ResolveRelativeDirectory(relativePath, _defaultBasePath);
		}

		protected string ResolveRelativeDirectory(string relativePath, string basePath)
		{
			return Path.Combine(basePath, relativePath);
		}
	}
}