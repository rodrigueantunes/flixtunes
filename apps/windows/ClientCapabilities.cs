using System;
using System.Collections.Generic;
using System.Linq;

namespace FlixTunes.Windows;

/// <summary>
/// Ce que ce poste sait réellement rendre, tel qu'il l'annonce au serveur.
///
/// La négociation de lecture repose entièrement sur cette déclaration : le serveur choisit la lecture
/// directe, le remultiplexage ou la conversion à partir d'elle. Une déclaration fausse ne se voit donc
/// pas comme une erreur — elle se voit comme une lecture qui échoue, ou comme un son qui manque.
///
/// Elle était fausse de deux façons. D'abord, la définition maximale annonçait **7680 × 4320** quelle
/// que soit la machine : un portable 1080p réclamait donc de la 8K en lecture directe. Ensuite, une
/// unique case « Écran HDR / Atmos » commandait à la fois le HDR, le Dolby Atmos, le DTS:X, l'Auro-3D,
/// seize canaux et l'audio sans perte. Or ces deux choses n'ont aucun rapport : un écran HDR branché
/// sur les haut-parleurs d'un portable est un cas ordinaire, et l'inverse aussi.
///
/// Ici, la définition vient de l'écran, le HDR de la case HDR, et le rendu audio d'un réglage qui lui
/// est propre.
/// </summary>
public enum SortieAudio
{
    /// <summary>Deux canaux — les haut-parleurs d'un portable, un casque. Le défaut, parce que c'est le cas le plus fréquent et le seul qui ne mente jamais.</summary>
    Stereo,
    /// <summary>Cinq canaux et un caisson.</summary>
    Surround51,
    /// <summary>Sept canaux et un caisson.</summary>
    Surround71,
    /// <summary>Flux transmis tel quel à un amplificateur, qui décode. C'est le seul cas où l'audio immersif et l'audio sans perte ont un sens.</summary>
    Amplificateur,
}

public sealed record ClientCapabilities
{
    public string[] containers { get; init; } = Array.Empty<string>();
    public string[] videoCodecs { get; init; } = Array.Empty<string>();
    public string[] audioCodecs { get; init; } = Array.Empty<string>();
    public bool hls { get; init; }
    public int maxWidth { get; init; }
    public int maxHeight { get; init; }
    public bool hdr { get; init; }
    public string[] hdrFormats { get; init; } = Array.Empty<string>();
    public bool dolbyAtmos { get; init; }
    public string[] immersiveAudioFormats { get; init; } = Array.Empty<string>();
    public int maxAudioChannels { get; init; }
    public bool losslessAudio { get; init; }
    public int? maxVideoBitrate { get; init; }
    public int? audioStreamIndex { get; init; }
    public int? subtitleStreamIndex { get; init; }
    public bool burnSubtitles { get; init; }

    /// <summary>Nombre de canaux qu'une sortie sait restituer.</summary>
    public static int CanauxDe(SortieAudio sortie) => sortie switch
    {
        SortieAudio.Surround51 => 6,
        SortieAudio.Surround71 => 8,
        // Un amplificateur reçoit le flux tel quel : ce n'est pas lui qui limite, c'est la piste.
        SortieAudio.Amplificateur => 16,
        _ => 2,
    };

    /// <summary>
    /// Assemble la déclaration.
    ///
    /// <paramref name="largeurEcran"/> et <paramref name="hauteurEcran"/> sont en pixels réels, mise à
    /// l'échelle de Windows comprise : une déclaration en points d'affichage sous-estimerait un écran
    /// à forte densité d'un tiers, et ferait convertir des vidéos que la machine affiche très bien.
    /// </summary>
    public static ClientCapabilities Pour(int largeurEcran, int hauteurEcran, bool hdr, SortieAudio sortie,
        int? audioStreamIndex = null, int? subtitleStreamIndex = null)
    {
        var amplificateur = sortie == SortieAudio.Amplificateur;
        // VLC décode tout cela quelle que soit la sortie — il redescend au besoin sur deux canaux.
        // Le codec dit ce qu'on sait lire ; c'est `maxAudioChannels` qui dit ce qu'on sait rendre.
        var codecsAudio = new List<string> { "aac", "opus", "mp3", "ac3", "eac3", "flac", "dts", "truehd" };
        return new ClientCapabilities
        {
            containers = new[] { "mp4", "webm", "mpegts" },
            videoCodecs = new[] { "h264", "hevc", "av1", "vp9", "vp8", "mpeg2video" },
            audioCodecs = codecsAudio.ToArray(),
            hls = true,
            maxWidth = Math.Max(640, largeurEcran),
            maxHeight = Math.Max(480, hauteurEcran),
            hdr = hdr,
            hdrFormats = hdr ? new[] { "hdr10", "hdr10plus", "hlg", "dolbyvision" } : Array.Empty<string>(),
            // L'audio immersif et l'audio sans perte n'ont de sens que transmis à un amplificateur :
            // reconstruire un Atmos sur deux haut-parleurs n'apporte rien et fait renoncer le serveur
            // à une conversion qui, elle, aurait été utile.
            dolbyAtmos = amplificateur,
            immersiveAudioFormats = amplificateur ? new[] { "dolby-atmos", "dts-x", "auro-3d" } : Array.Empty<string>(),
            maxAudioChannels = CanauxDe(sortie),
            losslessAudio = amplificateur,
            maxVideoBitrate = null,
            audioStreamIndex = audioStreamIndex,
            subtitleStreamIndex = subtitleStreamIndex is >= 0 ? subtitleStreamIndex : null,
            burnSubtitles = false,
        };
    }

    /// <summary>Lit un réglage enregistré, en retombant sur la stéréo — la seule valeur qui ne ment jamais.</summary>
    public static SortieAudio SortieDepuis(string? valeur) => valeur?.Trim().ToLowerInvariant() switch
    {
        "5.1" or "surround51" => SortieAudio.Surround51,
        "7.1" or "surround71" => SortieAudio.Surround71,
        "amplificateur" or "passthrough" => SortieAudio.Amplificateur,
        _ => SortieAudio.Stereo,
    };

    public static string NomDe(SortieAudio sortie) => sortie switch
    {
        SortieAudio.Surround51 => "5.1",
        SortieAudio.Surround71 => "7.1",
        SortieAudio.Amplificateur => "amplificateur",
        _ => "stereo",
    };
}
