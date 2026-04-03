using Microsoft.Extensions.Logging;

namespace YobaPub.Proxy;

public sealed class LiteDbLoggerProvider(LogStore store, DebugSettingsStore debugSettings) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) =>
        new LiteDbLogger(categoryName, store, debugSettings);

    public void Dispose() { }
}

file sealed class LiteDbLogger(string category, LogStore store, DebugSettingsStore debugSettings) : ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) =>
        debugSettings.IsEnabled && logLevel >= LogLevel.Information;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(logLevel)) return;

        var level = logLevel switch
        {
            LogLevel.Critical    => "Error",
            LogLevel.Error       => "Error",
            LogLevel.Warning     => "Warning",
            LogLevel.Information => "Information",
            _                    => "Verbose"
        };

        var message = formatter(state, exception);
        if (exception != null)
            message += " " + exception.Message;

        store.Add(new LogEntry
        {
            ServerTs   = DateTimeOffset.UtcNow,
            Level      = level,
            Category   = category,
            Message    = message,
            DeviceId   = "server",
            ClientIp   = "",
            TraceId    = "",
            StackTrace = exception?.ToString() ?? "",
        });
    }
}
