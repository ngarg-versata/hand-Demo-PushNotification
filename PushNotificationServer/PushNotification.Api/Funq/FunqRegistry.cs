using AtHand.FMS.Server;
using AtHand.PushNotification;
using AtHand.PushNotification.ServiceModel;
using Funq;
using System.IO;

namespace PushNotification.Api.Funq
{
    public class FunqRegistry
    {
        public static string ConfigProvider = "PushNotificationTest";
		public static string ApiToken = "aHgB_iNTCVXGnUygS4NObmJo0pfMNOqIQu7TDihh41wcVyhsVnnmq7zLEQZWz9j61V4YG4M4FABRGu7-Jf5KfA2";

        public static void Configure(Container container)
        {
            ConfigureConfigurationProviders(container);
            ConfigureMTier(container);
            ConfigurePushNotifications(container);
        }

        private static void ConfigureConfigurationProviders(Container container)
        {
            // Find the parent base path for the config paths
            var containingDirectory = Path.Combine(AppHost.AssemblyDirectory, "..");
            // In development, there will be an App_Start directory. In this case, we look in its parent directory
            if (Directory.Exists(Path.Combine(containingDirectory, "App_Start")))
            {
                containingDirectory = Path.Combine(containingDirectory, "..");
            }

            // Register Config Providers
            container.Register<ConfigProvider>(new ConfigProvider(containingDirectory));
            container.RegisterImplementationAs<ConfigProvider, IConfigProvider>();
            container.RegisterImplementationAs<ConfigProvider, IDataConfigProvider>();
        }

        private static void ConfigureMTier(Container container)
        {
            // Register MTier Providers
            container.RegisterAutoWired<MTierProvider>();
            container.RegisterImplementationAs<MTierProvider, IMTierProvider>();
            container.Register<MTier>(c => c.Resolve<IMTierProvider>().GetMTier()).ReusedWithin(ReuseScope.Request);
        }

        private static void ConfigurePushNotifications(Container container)
        {
            // Register a request-scoped channel connection becuase it needs a request scoped M-Tier Connection
            container.Register<ChannelConnection>(
                c =>
                    new ChannelConnection(c.Resolve<MTier>(), ConfigProvider, ApiToken)
                ).ReusedWithin(ReuseScope.Request);

            container.RegisterImplementationAs<ChannelConnection, IChannelConnection>().ReusedWithin(ReuseScope.Request);
        }
    }
}