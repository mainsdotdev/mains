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

// Metal port of the desktop voice-orb-renderer shader. These are its stock
// Theme palette colors after the CSS values are resolved to sRGB.
constant float3 voiceOrbDeep = float3(34, 87, 204) / 255.0;
constant float3 voiceOrbSoft = float3(185, 205, 249) / 255.0;
constant float3 voiceOrbLight = float3(238, 243, 253) / 255.0;
constant float3 voiceOrbSecondary = float3(190, 147, 220) / 255.0;
constant float3 voiceOrbTertiary = float3(165, 222, 182) / 255.0;

static float voiceOrbHash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float voiceOrbNoise(float2 p) {
    float2 cell = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(voiceOrbHash(cell), voiceOrbHash(cell + float2(1.0, 0.0)), f.x),
               mix(voiceOrbHash(cell + float2(0.0, 1.0)), voiceOrbHash(cell + float2(1.0)), f.x), f.y);
}

static float voiceOrbCloud(float2 p) {
    float value = 0.0;
    float weight = 0.55;
    float2x2 bend = float2x2(float2(0.8, -0.6), float2(0.6, 0.8));
    for (int i = 0; i < 4; i++) {
        value += weight * voiceOrbNoise(p);
        p = bend * p * 1.92 + 7.3;
        weight *= 0.45;
    }
    return value;
}

static float3 voiceCloudColor(float2 p, float flow, float energy) {
    float2 drift = float2(flow * 0.24, -flow * 0.18);
    float2 breeze = float2(sin(flow * 0.42), cos(flow * 0.31)) * 0.3;
    float2 wind = float2(voiceOrbCloud(p * 1.25 + drift),
                         voiceOrbCloud(p * 1.25 - drift * 0.7 + 9.2)) - 0.48;
    float2 curl = p + breeze + wind * (1.5 + energy * 0.7);
    curl += (float2(voiceOrbCloud(curl * 1.5 + drift + 3.7),
                  voiceOrbCloud(curl * 1.5 - drift + 12.4)) - 0.48) * 0.75;

    float mist = voiceOrbCloud(curl * 1.65 + drift * 0.5);
    float billow = voiceOrbCloud(curl * 1.1 - drift * 0.65 + 5.6);
    float ribbon = curl.x * 0.46 + curl.y * 0.2 + (mist - 0.48) * 2.15 + (billow - 0.48) * 0.65;
    float warmth = smoothstep(-0.55, 0.72, ribbon);
    float3 color = mix(voiceOrbDeep, voiceOrbSoft, warmth);
    float light = smoothstep(0.04, 0.72, ribbon + billow * 0.25);
    color = mix(color, voiceOrbLight, light);

    // Shading stays gentle; only the interior flows, never the circular edge.
    float shade = 0.96 + 0.04 * smoothstep(-1.0, 1.0, p.y - p.x * 0.3);
    return color * shade;
}

static float voiceOrbVolumeNoise(float3 p) {
    float3 cell = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float2 layer = cell.xy + float2(37.0, 17.0) * cell.z;
    float nearLayer = mix(mix(voiceOrbHash(layer), voiceOrbHash(layer + float2(1.0, 0.0)), f.x),
                     mix(voiceOrbHash(layer + float2(0.0, 1.0)), voiceOrbHash(layer + float2(1.0)), f.x), f.y);
    layer += float2(37.0, 17.0);
    float farLayer = mix(mix(voiceOrbHash(layer), voiceOrbHash(layer + float2(1.0, 0.0)), f.x),
                    mix(voiceOrbHash(layer + float2(0.0, 1.0)), voiceOrbHash(layer + float2(1.0)), f.x), f.y);
    return mix(nearLayer, farLayer, f.z);
}

static float voiceOrbVolumeCloud(float3 p) {
    // Broad banks plus a softer detail layer; no high-frequency ripples.
    return voiceOrbVolumeNoise(p) * 0.65 + voiceOrbVolumeNoise(p.yzx * 1.85 + float3(3.7, 7.3, 5.1)) * 0.35;
}

static float3 voiceSphereColor(float2 p, float flow, float energy, float2 grainPixel) {
    // Keep spherical depth while advecting clouds through its interior.
    float depth = sqrt(max(0.0, 1.0 - dot(p, p)));
    float3 normal = float3(p, depth);
    float3 medium = float3(p * 1.1, depth * 0.65);
    float angle = flow * 0.14;
    medium.xy = float2x2(float2(cos(angle), -sin(angle)), float2(sin(angle), cos(angle))) * medium.xy;
    float3 drift = float3(flow * 0.21, -flow * 0.16, flow * 0.13);
    float3 wind = float3(
        voiceOrbVolumeCloud(medium * 1.15 + drift),
        voiceOrbVolumeCloud(medium.yzx * 1.1 - drift * 0.75 + 8.7),
        voiceOrbVolumeCloud(medium.zxy * 1.2 + drift * 0.6 + 17.9)
    ) - 0.5;
    float3 curl = medium + wind * (1.25 + energy * 0.15);
    curl += sin(curl.yzx * 2.0 + drift * 0.65) * 0.18;

    float bank = voiceOrbVolumeCloud(curl * 1.55 + drift * 0.45);
    float wisp = voiceOrbVolumeCloud(curl * 1.3 - drift * 0.6 + 5.6);
    float ribbon = curl.x * 0.32 + curl.y * 0.18 + (bank - 0.5) * 1.45 + (wisp - 0.5) * 0.65;
    float3 color = mix(voiceOrbDeep, voiceOrbSoft, smoothstep(-0.55, 0.65, ribbon));
    float secondary = voiceOrbVolumeCloud(curl * 1.1 + drift * 0.3 + 11.3);
    float tertiary = voiceOrbVolumeCloud(curl * 1.35 - drift * 0.5 + 21.7);
    color = mix(color, voiceOrbSecondary, smoothstep(0.36, 0.67, secondary) * 0.86);
    color = mix(color, voiceOrbTertiary, smoothstep(0.35, 0.69, tertiary) * 0.82);
    float light = smoothstep(0.48, 0.73, bank + (wisp - 0.5) * 0.35);
    color = mix(color, voiceOrbLight, light * 0.62);

    float diffuse = max(0.0, dot(normal, normalize(float3(-0.72, 0.58, 0.67))));
    color *= 0.55 + 0.49 * pow(diffuse, 0.9);
    float highlight = pow(max(0.0, dot(normal, normalize(float3(-0.47, 0.51, 1.0)))), 20.0) * 0.24;
    float rim = pow(1.0 - depth, 3.0) * diffuse * 0.18;
    color = mix(color, voiceOrbLight, highlight + rim);
    // Film grain stays fixed in screen space: the clouds move without flicker.
    float grain = (voiceOrbHash(floor(grainPixel)) - 0.5) * 0.07;
    return clamp(color + grain, 0.0, 1.0);
}

static float3 voiceAuroraColor(float2 p, float flow, float energy, float2 voice) {
    float depth = sqrt(max(0.0, 1.0 - dot(p, p)));
    float3 normal = float3(p, depth);
    float3 medium = normal;
    // Laminar folds curl through the volume, leaving the glass silhouette still.
    float turn = flow * 0.12 + depth * 1.25;
    medium.xy = float2x2(float2(cos(turn), -sin(turn)), float2(sin(turn), cos(turn))) * medium.xy;
    medium.yz = float2x2(float2(0.94, -0.342), float2(0.342, 0.94)) * medium.yz;
    float3 drift = float3(flow * 0.12, -flow * 0.09, flow * 0.07);
    float bank = voiceOrbVolumeCloud(medium * 1.45 + drift);
    float veil = voiceOrbVolumeCloud(medium.zxy * 1.6 - drift * 0.7 + 9.4);
    float fold = medium.y * 2.15 + medium.x * 0.3
      + sin(medium.x * 2.8 + medium.z * 1.6 + flow * 0.16) * (0.55 + energy * 0.08)
      + (bank - 0.5) * 1.25 + (veil - 0.5) * 0.45;
    float phase = fold * 3.8 - flow * 0.22;
    float ribbon = 0.5 + 0.5 * sin(phase);
    float pearl = smoothstep(0.24, 0.94, ribbon);
    float hue = smoothstep(-0.65, 0.8, medium.x + (veil - 0.5) * 1.6);
    float3 silk = mix(voiceOrbTertiary, voiceOrbSecondary, hue);
    float3 color = mix(voiceOrbDeep * 0.56, voiceOrbSoft, 0.16 + bank * 0.24);
    color = mix(color, silk, pearl * 0.88);
    color = mix(color, voiceOrbLight, pow(ribbon, 5.0) * (0.52 + voice.y * 0.1));

    // A narrow luminous hem gives each broad ribbon depth at compact sizes.
    float hem = pow(0.5 + 0.5 * cos(phase - 0.72), 56.0);
    float underside = pow(0.5 + 0.5 * cos(phase - 1.12), 18.0);
    color *= 1.0 - underside * 0.2;
    color = mix(color, voiceOrbLight, hem * (0.58 + voice.x * 0.1));
    float diffuse = max(0.0, dot(normal, normalize(float3(-0.5, 0.65, 0.9))));
    color *= 0.65 + diffuse * 0.36;
    float fresnel = pow(1.0 - depth, 2.7);
    color = mix(color, mix(voiceOrbSoft, voiceOrbLight, 0.65), fresnel * (0.28 + diffuse * 0.3));
    float glint = pow(max(0.0, dot(normal, normalize(float3(-0.38, 0.48, 0.8)))), 80.0);
    float reflection = pow(max(0.0, dot(normal, normalize(float3(0.6, -0.5, 0.55)))), 28.0);
    color = mix(color, voiceOrbLight, glint * 0.72 + reflection * 0.16);
    return clamp(color, 0.0, 1.0);
}

enum class VoiceDesktopOrbStyle { cloud, sphere, aurora };

static half4 voiceDesktopOrb(float2 position, half4 source, float2 size,
                             float flow, float2 voice, VoiceDesktopOrbStyle style) {
    float diameter = min(size.x, size.y);
    float2 point = (position - size * 0.5) / (diameter * 0.5);
    point.y = -point.y; // The desktop shader uses WebGL's upward y axis.
    float distance = length(point);
    float pixels = min(256.0, diameter * 2.0);
    float edge = max(fwidth(distance), 2.0 / pixels);
    float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, distance);
    if (alpha <= 0.0) return half4(0.0);

    float energy = max(voice.x, voice.y);
    float3 color;
    switch (style) {
    case VoiceDesktopOrbStyle::cloud:
        color = voiceCloudColor(point, flow, energy);
        break;
    case VoiceDesktopOrbStyle::sphere:
        color = voiceSphereColor(point, flow, energy, (point * 0.5 + 0.5) * pixels);
        break;
    case VoiceDesktopOrbStyle::aurora:
        color = voiceAuroraColor(point, flow, energy, voice);
        break;
    }
    return half4(half3(color * alpha), half(alpha)) * source.a;
}

[[ stitchable ]] half4 voiceCloud(float2 position, half4 source, float2 size,
                                  float flow, float input, float output, float dark) {
    return voiceDesktopOrb(position, source, size, flow, float2(input, output), VoiceDesktopOrbStyle::cloud);
}

[[ stitchable ]] half4 voiceSphere(float2 position, half4 source, float2 size,
                                   float flow, float input, float output, float dark) {
    return voiceDesktopOrb(position, source, size, flow, float2(input, output), VoiceDesktopOrbStyle::sphere);
}

[[ stitchable ]] half4 voiceAurora(float2 position, half4 source, float2 size,
                                   float flow, float input, float output, float dark) {
    return voiceDesktopOrb(position, source, size, flow, float2(input, output), VoiceDesktopOrbStyle::aurora);
}
