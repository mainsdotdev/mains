#include <metal_stdlib>
using namespace metal;

// Analytic waves give the water a continuously evolving normal without a
// texture, ray marcher, or repeated noise evaluations per pixel.
static float4 voiceWaterWaves(float3 p, float time) {
    const float3 a = float3(0.81, 0.44, 0.38);
    const float3 b = float3(-0.36, 0.86, 0.35);
    const float3 c = float3(0.28, -0.52, 0.81);
    const float3 d = float3(0.69, 0.23, -0.68);
    float4 phase = float4(dot(p,a)*7.0, dot(p,b)*10.5, dot(p,c)*16.0, dot(p,d)*24.0)
        + time * float4(0.53, -0.41, 0.32, -0.24);
    float4 wave = sin(phase);
    float4 slope = cos(phase) * float4(0.56, 0.42, 0.29, 0.17);
    float height = dot(wave, float4(0.080, 0.040, 0.018, 0.007));
    return float4(a*slope.x + b*slope.y + c*slope.z + d*slope.w, height);
}

static float3 voiceWaterEnvironment(float3 direction, float dark) {
    float horizon = exp(-pow((direction.y - 0.05) * 2.8, 2.0));
    // A bright studio environment keeps the water icy cyan in either theme.
    float3 sky = mix(float3(0.64, 0.82, 0.88), float3(0.60, 0.79, 0.86), dark);
    float3 light = mix(float3(0.94, 0.99, 1.0), float3(0.90, 0.97, 1.0), dark);
    float3 color = mix(sky * 0.78, light, horizon * 0.72);
    float window = exp(-pow((direction.x + 0.45) * 3.7, 2.0)
                       -pow((direction.y - 0.58) * 6.0, 2.0));
    float strip = exp(-pow((direction.x - 0.68) * 10.0, 2.0))
        * smoothstep(-0.5, 0.8, direction.y);
    float softbox = pow(saturate(dot(direction, normalize(float3(0.65, -0.38, 0.66)))), 14.0);
    float lower = pow(saturate(dot(direction, normalize(float3(-0.55, -0.65, 0.35)))), 19.0);
    return color + float3(1.0, 1.04, 1.10) * (window * 2.1 + strip * 0.7 + softbox * 1.3 + lower * 1.1);
}

[[ stitchable ]] half4 voiceWater(float2 position, half4 source, float2 size,
                                 float time, float input, float output, float dark) {
    float2 uv = (position - size * 0.5) / (min(size.x, size.y) * 0.5);
    float energy = saturate(max(input, output));
    float angle = atan2(uv.y, uv.x);
    // Speech visibly expands and deforms the water, with space left inside
    // the view even at full volume. Both input and output drive the silhouette.
    float radius = 0.89 + energy * 0.024 + (0.010 + energy * 0.032)
        * (sin(angle * 3.0 + time * 0.66) + sin(angle * 5.0 - time * 0.43) * 0.40);
    float distance = length(uv);
    float alpha = 1.0 - smoothstep(radius - fwidth(distance), radius + fwidth(distance), distance);
    if (alpha <= 0.0) return half4(0.0);

    float2 xy = uv / radius;
    xy.y = -xy.y;
    float depth = sqrt(max(0.0, 1.0 - dot(xy,xy)));
    float3 sphere = float3(xy, depth);
    float4 wave = voiceWaterWaves(sphere, time);
    // Mic speech sends ripples across the surface; agent speech adds a broader
    // rolling swell. Their phases share the continuous, audio-driven flow clock.
    wave.xyz += float3(0.0, 1.0, 0.0) * cos(sphere.y * 12.0 - time * 1.3) * input * 0.24;
    wave.xyz += float3(0.8, -0.5, 0.0) * cos(dot(sphere.xy, float2(0.8, -0.5)) * 7.0 + time * 0.9) * output * 0.28;
    float3 tangent = wave.xyz - sphere * dot(wave.xyz, sphere);
    float3 normal = normalize(sphere - tangent * (0.48 + energy * 0.45));
    float3 ray = float3(0.0, 0.0, -1.0);
    float3 reflection = reflect(ray, normal);
    float3 refraction = refract(ray, normal, 1.0 / 1.333);
    float fresnel = 0.028 + 0.972 * pow(1.0 - saturate(normal.z), 5.0);

    float3 reflected = voiceWaterEnvironment(reflection, dark);
    float3 transmitted = voiceWaterEnvironment(refraction * float3(1.0,-1.0,1.0), dark);
    float3 absorption = exp(-float3(0.65, 0.23, 0.07) * depth);
    float3 tint = mix(float3(0.54, 0.79, 0.86), float3(0.50, 0.76, 0.84), dark);
    float3 color = tint * 0.24 + transmitted * absorption * 0.76;

    // Reflected caustic bands bend with the moving water normal, producing
    // highlights inside the sphere rather than a flat gradient over a circle.
    float2 causticUV = sphere.xy * 3.6 + normal.xy * 1.7;
    float causticA = sin(causticUV.x * 3.1 + sin(causticUV.y * 2.2 + time * 0.31));
    float causticB = sin(causticUV.y * 3.7 - cos(causticUV.x * 2.6 - time * 0.24));
    float caustic = pow(saturate(1.0 - abs(causticA + causticB) * 0.72), 9.0);
    caustic *= smoothstep(0.05, 0.50, depth);
    color += float3(0.25, 0.71, 0.92) * caustic * (0.05 + energy * 0.14);
    color = mix(color, reflected, 0.48 + fresnel * 0.47);

    float rim = pow(1.0 - depth, 3.0);
    color += float3(0.24, 0.86, 0.98) * rim * (0.38 + saturate(-sphere.y) * 0.45);
    float3 key = normalize(float3(-0.50, 0.72, 1.3));
    float glint = pow(saturate(dot(normal, key)), 110.0);
    float shoulder = pow(saturate(dot(normal, key)), 13.0);
    color += float3(0.90, 0.98, 1.0) * (glint * 1.0 + shoulder * 0.16);
    color *= 0.88 + depth * 0.12;
    color = color / (1.0 + color * 0.22);
    return half4(half3(color * alpha), half(alpha)) * source.a;
}
