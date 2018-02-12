using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Web.Http;
using AtHand.PushNotification;
using AtHand.PushNotification.ServiceModel;
using PushNotification.Api.Funq;

namespace PushNotification.Api.Controllers
{
    public class PushNotificationController : ApiController
    {
        private IChannelConnection _channelConnection;

        //public PushNotificationController(IChannelConnection channelConnection)
        //{
        //    _channelConnection = channelConnection;
        //}

        [HttpGet]
        public HttpResponseMessage Send()
        {
            try
            {
                var configProvider = FunqRegistry.ConfigProvider;
                var apiToken = FunqRegistry.ApiToken;
                var dataProvider = new ConfigProvider("");
                var mtierProvider = new MTierProvider(dataProvider);
                var mtier = mtierProvider.GetMTier();
                _channelConnection = new ChannelConnection(mtier, configProvider, apiToken);

                var dueTime = DateTime.Now.AddDays(2).ToShortDateString();
                const string description = "Test Description";

                // Send the notification
                _channelConnection.SendNotification(new Notification
                {
                    Title = "New Work Order Assignment",
                    Message = string.Format("{0}. You are assigned a new work order{1}.", description, dueTime)
                    //ActionCode = "WorkOrderAssignment",
                    //ActionData = new Dictionary<string, object>
                    //{
                    //    {"Prop1", "Prop1Value"},
                    //}
                }, 73);
            }
            catch (Exception ex)
            {
                throw new Exception(
                    string.Format("Failed sending push notification. Details are: Message: {0}, StackTrace: {1}",
                        ex.Message, ex.StackTrace));
            }

            return Request.CreateResponse(HttpStatusCode.OK);
        }

    }
}
