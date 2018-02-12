using System;
using System.Configuration;
using AtHand.FMS.Server;

namespace PushNotification.Api
{
	public class MTierProvider : IMTierProvider
	{
		private readonly IDataConfigProvider _dataConfigProvider;

		public MTierProvider(IDataConfigProvider dataConfigProvider)
		{
			_dataConfigProvider = dataConfigProvider;
		}

		public MTier GetMTier(bool distribute = true)
		{
			if (string.IsNullOrEmpty(_dataConfigProvider.MTierContext))
			{
				throw new ConfigurationErrorsException("mtierContext is not defined.");
			}
			var mtier =
				new MTier(String.Format("{0}.{1}", _dataConfigProvider.MTierSessionPrefix, _dataConfigProvider.MTierContext),
					_dataConfigProvider.MTierContext);
			mtier.Connect();
		    mtier.MDOConnection.Distribute = 0;
			return mtier;
		}
	}
}