using System;
using System.IO;
using System.Reflection;
using Funq;
using PushNotification.Api;
using PushNotification.Api.Funq;
using ServiceStack;
using ServiceStack.Logging;
using ServiceStack.Text;
using WebActivatorEx;

[assembly: PreApplicationStartMethod(typeof (AppHost), "Start")]

namespace PushNotification.Api
{
	public class AppHost : AppHostBase
	{
		public static string AssemblyDirectory
		{
			get
			{
				var codeBase = Assembly.GetExecutingAssembly().CodeBase;
				var uri = new UriBuilder(codeBase);
				var path = Uri.UnescapeDataString(uri.Path);
				return Path.GetDirectoryName(path);
			}
		}

        public AppHost()
            : base("", new []{typeof(AppHost).Assembly})
		{
		}

		public override void Configure(Container container)
		{
			FunqRegistry.Configure(container);
		}

		public static void Start()
		{
			new AppHost().Init();
		}
	}
}