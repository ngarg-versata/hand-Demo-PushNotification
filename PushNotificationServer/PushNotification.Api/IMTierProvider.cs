using AtHand.FMS.Server;

namespace PushNotification.Api
{
	public interface IMTierProvider
	{
		MTier GetMTier(bool distribute = true);
	}
}