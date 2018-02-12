using System;
using Funq;

namespace PushNotification.Api.Funq
{
	public static class FunqExtensions
	{
		/// <summary>Aliases an existing, registered type to another type to which it is assignable</summary>
		/// <remarks>
		///     This is designed to make an implementation available as one of the interfaces or supertypes that it
		///     implements. Whereas <see cref="Container.RegisterAs{T,TAs}" /> and
		///     <see cref="Container.RegisterAutoWiredAs{T,TAs}" />
		///     will re-autowire and create a new instance of the implementation to register, this method will instead resolve an
		///     existing instance of the implementation and use that.
		/// </remarks>
		/// <example>
		///     Here's an example that makes the <c>AdminServiceDatabase</c> available both as the concrete type and as the
		///     interface it implements. Anything that tries to resolve either <c>AdminServiceDatabase</c> or
		///     <c>IAdminServiceDatabase</c> will get the same instance:
		///     <code>
		/// 		container.RegisterAutoWired&lt;AdminServiceDatabase&gt;();
		/// 		container.RegisterImplementationAs&gt;AdminServiceDatabase,IAdminServiceDatabase&lt;(); 
		///  </code>
		/// </example>
		/// <typeparam name="TImplementation">The type to resolve</typeparam>
		/// <typeparam name="TInterface">The type to register the resolved instance as</typeparam>
		/// <param name="container">The container to use for resolution and registration</param>
		public static IRegistration<TInterface> RegisterImplementationAs<TImplementation, TInterface>(this Container container)
			where TImplementation : TInterface
		{
			if (container == null)
			{
				throw new Exception("container");
			}

			return container.Register<TInterface>(c => c.Resolve<TImplementation>());
		}
	}
}