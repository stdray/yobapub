using System.ComponentModel;
using System.Globalization;

namespace YobaPub.Proxy;

[TypeConverter(typeof(ShortGuidTypeConverter))]
public readonly struct ShortGuid : IEquatable<ShortGuid>
{
    public Guid Value { get; }

    public ShortGuid(Guid value) => Value = value;

    public static ShortGuid NewShortGuid() => new(Guid.NewGuid());

    public override string ToString()
    {
        Span<byte> bytes = stackalloc byte[16];
        Value.TryWriteBytes(bytes);
        Span<char> chars = stackalloc char[24];
        Convert.TryToBase64Chars(bytes, chars, out _);
        for (var i = 0; i < 22; i++)
        {
            chars[i] = chars[i] switch { '+' => '-', '/' => '_', _ => chars[i] };
        }
        return new string(chars[..22]);
    }

    public static bool TryParse(string? s, out ShortGuid result)
    {
        result = default;
        if (string.IsNullOrEmpty(s)) return false;

        if (s.Length == 22)
        {
            Span<char> chars = stackalloc char[24];
            for (var i = 0; i < 22; i++)
            {
                chars[i] = s[i] switch { '-' => '+', '_' => '/', _ => s[i] };
            }
            chars[22] = '=';
            chars[23] = '=';

            Span<byte> bytes = stackalloc byte[16];
            if (!Convert.TryFromBase64Chars(chars, bytes, out var written) || written != 16)
                return false;
            result = new ShortGuid(new Guid(bytes));
            return true;
        }

        if (Guid.TryParse(s, out var guid))
        {
            result = new ShortGuid(guid);
            return true;
        }
        return false;
    }

    public static ShortGuid Parse(string s) =>
        TryParse(s, out var result) ? result : throw new FormatException($"Invalid ShortGuid: {s}");

    public bool Equals(ShortGuid other) => Value.Equals(other.Value);
    public override bool Equals(object? obj) => obj is ShortGuid other && Equals(other);
    public override int GetHashCode() => Value.GetHashCode();
    public static bool operator ==(ShortGuid a, ShortGuid b) => a.Equals(b);
    public static bool operator !=(ShortGuid a, ShortGuid b) => !a.Equals(b);

    public static implicit operator Guid(ShortGuid s) => s.Value;
    public static implicit operator ShortGuid(Guid g) => new(g);
}

public class ShortGuidTypeConverter : TypeConverter
{
    public override bool CanConvertFrom(ITypeDescriptorContext? ctx, Type sourceType) =>
        sourceType == typeof(string) || base.CanConvertFrom(ctx, sourceType);

    public override object? ConvertFrom(ITypeDescriptorContext? ctx, CultureInfo? culture, object value) =>
        value is string s && ShortGuid.TryParse(s, out var sg)
            ? sg
            : throw new FormatException($"Invalid ShortGuid: {value}");

    public override bool CanConvertTo(ITypeDescriptorContext? ctx, Type? destinationType) =>
        destinationType == typeof(string) || base.CanConvertTo(ctx, destinationType);

    public override object? ConvertTo(ITypeDescriptorContext? ctx, CultureInfo? culture, object? value, Type destinationType) =>
        destinationType == typeof(string) && value is ShortGuid sg
            ? sg.ToString()
            : base.ConvertTo(ctx, culture, value, destinationType);
}
