using LiteDB;
using System.Text.Json.Serialization;

namespace YobaPub.Proxy;

public class PlaybackErrorEntry
{
    [JsonIgnore]
    public ObjectId Id { get; set; } = ObjectId.NewObjectId();
    public DateTimeOffset ServerTs { get; set; }
    public string Domain { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string UserAgent { get; set; } = "";
    public string ErrorDetails { get; set; } = "";
    public string Url { get; set; } = "";
    public string ClientIp { get; set; } = "";
}
