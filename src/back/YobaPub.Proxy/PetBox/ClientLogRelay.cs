using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy.PetBox;

// Bounded in-memory queue between the /api/log endpoints and the background forwarder.
// Overflow drops the oldest events first — recent context matters most for debugging.
public sealed class ClientLogRelay
{
    readonly Channel<ClientLogEvent> channel;
    long dropped;

    public ClientLogRelay(IOptions<PetBoxOptions> options)
    {
        channel = Channel.CreateBounded<ClientLogEvent>(
            new BoundedChannelOptions(options.Value.RelayQueueCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            },
            _ => Interlocked.Increment(ref dropped));
    }

    public ChannelReader<ClientLogEvent> Reader => channel.Reader;

    public void Enqueue(ClientLogEvent entry) => channel.Writer.TryWrite(entry);

    // Number of events dropped to overflow since the previous call.
    public long TakeDropped() => Interlocked.Exchange(ref dropped, 0);
}
