using System.Text;
using System.Text.Json;

namespace YobaPub.Proxy.PetBox;

// Serializes client log events into CLEF NDJSON (one compact JSON object per line).
// Uses @m (pre-rendered message), not @mt: client messages may contain braces that
// must not be re-parsed as message templates. @t is the server receive time — TV
// clocks are unreliable; the original client timestamp travels as ClientTs.
public static class ClefWriter
{
    public static string Write(IReadOnlyList<ClientLogEvent> batch)
    {
        var stream = new MemoryStream();
        for (var i = 0; i < batch.Count; i++)
        {
            WriteEvent(stream, batch[i]);
            stream.WriteByte((byte)'\n');
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    static void WriteEvent(Stream stream, ClientLogEvent entry)
    {
        using var writer = new Utf8JsonWriter(stream);
        writer.WriteStartObject();
        writer.WriteString("@t", entry.ServerTs.UtcDateTime.ToString("O"));
        writer.WriteString("@l", entry.Level);
        writer.WriteString("@m", entry.Message);
        writer.WriteString("Category", entry.Category);
        writer.WriteString("DeviceId", entry.DeviceId);
        writer.WriteString("ClientIp", entry.ClientIp);
        if (entry.TraceId.Length > 0) writer.WriteString("TraceId", entry.TraceId);
        if (entry.ClientTs > 0) writer.WriteNumber("ClientTs", entry.ClientTs);
        if (entry.Props is { } props)
        {
            writer.WritePropertyName("Props");
            props.WriteTo(writer);
        }
        writer.WriteEndObject();
        writer.Flush();
    }
}
