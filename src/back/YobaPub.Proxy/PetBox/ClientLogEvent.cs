using System.Text.Json;

namespace YobaPub.Proxy.PetBox;

// One normalized client telemetry event (regular log or playback error) on its way
// to the PetBox `clients` log. Props must be a clone detached from its JsonDocument.
public sealed record ClientLogEvent(
    DateTimeOffset ServerTs,
    long ClientTs,
    string Level,
    string Category,
    string Message,
    string DeviceId,
    string ClientIp,
    string TraceId,
    JsonElement? Props);
