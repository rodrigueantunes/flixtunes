using FlixTunes.Windows;

namespace FlixTunes.Windows.Tests;

/// <summary>
/// Ce que le client annonce au serveur, et ce qu'il n'a pas le droit d'inventer.
///
/// La négociation de lecture repose entièrement sur cette déclaration. Une déclaration fausse ne se
/// voit pas comme une erreur : elle se voit comme une lecture qui échoue, ou comme un son qui manque.
/// </summary>
[TestClass]
public class ClientCapabilitiesTests
{
    [TestMethod]
    public void LaDefinitionVientDeLEcranEtNonDUneConstante()
    {
        // Elle annonçait 7680 x 4320 quelle que soit la machine : un portable 1080p réclamait de la 8K
        // en lecture directe, et le serveur le croyait.
        var capacites = ClientCapabilities.Pour(1920, 1080, hdr: false, SortieAudio.Stereo);

        Assert.AreEqual(1920, capacites.maxWidth);
        Assert.AreEqual(1080, capacites.maxHeight);
    }

    [TestMethod]
    public void UneDefinitionAberranteEstRelevee()
    {
        // Un écran non encore mesuré rendrait zéro, et un plafond à zéro ferait échouer toute lecture.
        var capacites = ClientCapabilities.Pour(0, 0, hdr: false, SortieAudio.Stereo);

        Assert.AreEqual(640, capacites.maxWidth);
        Assert.AreEqual(480, capacites.maxHeight);
    }

    [TestMethod]
    public void LeHdrNAucunEffetSurLAudio()
    {
        /*
         * Le défaut le plus coûteux : une unique case commandait le HDR, le Dolby Atmos, le DTS:X,
         * l'Auro-3D, seize canaux et l'audio sans perte. Un écran HDR branché sur les haut-parleurs
         * d'un portable annonçait donc seize canaux immersifs — et le serveur renonçait au mixage
         * dont ce portable avait précisément besoin.
         */
        var capacites = ClientCapabilities.Pour(3840, 2160, hdr: true, SortieAudio.Stereo);

        Assert.IsTrue(capacites.hdr);
        CollectionAssert.Contains(capacites.hdrFormats, "dolbyvision");
        Assert.AreEqual(2, capacites.maxAudioChannels, "l'écran ne dit rien des haut-parleurs");
        Assert.IsFalse(capacites.dolbyAtmos);
        Assert.IsFalse(capacites.losslessAudio);
        Assert.AreEqual(0, capacites.immersiveAudioFormats.Length);
    }

    [TestMethod]
    public void LAudioNAucunEffetSurLeHdr()
    {
        // Et réciproquement : un amplificateur ne rend pas un écran capable d'afficher du HDR.
        var capacites = ClientCapabilities.Pour(1920, 1080, hdr: false, SortieAudio.Amplificateur);

        Assert.IsFalse(capacites.hdr);
        Assert.AreEqual(0, capacites.hdrFormats.Length);
        Assert.IsTrue(capacites.dolbyAtmos);
        Assert.IsTrue(capacites.losslessAudio);
    }

    [TestMethod]
    public void ChaqueSortieAnnonceSesCanaux()
    {
        Assert.AreEqual(2, ClientCapabilities.CanauxDe(SortieAudio.Stereo));
        Assert.AreEqual(6, ClientCapabilities.CanauxDe(SortieAudio.Surround51));
        Assert.AreEqual(8, ClientCapabilities.CanauxDe(SortieAudio.Surround71));
        Assert.AreEqual(16, ClientCapabilities.CanauxDe(SortieAudio.Amplificateur));
    }

    [TestMethod]
    public void LesCodecsRestentCeQueVlcSaitLire()
    {
        // Le codec dit ce qu'on sait décoder — VLC redescend au besoin sur deux canaux ; c'est
        // `maxAudioChannels` qui dit ce qu'on sait restituer. Retirer TrueHD d'un poste stéréo ferait
        // convertir des pistes que la machine lit parfaitement.
        var capacites = ClientCapabilities.Pour(1920, 1080, hdr: false, SortieAudio.Stereo);

        CollectionAssert.Contains(capacites.audioCodecs, "truehd");
        CollectionAssert.Contains(capacites.audioCodecs, "dts");
        Assert.AreEqual(2, capacites.maxAudioChannels);
    }

    [TestMethod]
    public void UnReglageInconnuRetombeSurLaStereo()
    {
        // La seule valeur qui ne ment jamais : deux haut-parleurs existent toujours.
        Assert.AreEqual(SortieAudio.Stereo, ClientCapabilities.SortieDepuis(null));
        Assert.AreEqual(SortieAudio.Stereo, ClientCapabilities.SortieDepuis(""));
        Assert.AreEqual(SortieAudio.Stereo, ClientCapabilities.SortieDepuis("dolby-atmos-16-canaux"));
        Assert.AreEqual(SortieAudio.Surround51, ClientCapabilities.SortieDepuis("5.1"));
        Assert.AreEqual(SortieAudio.Amplificateur, ClientCapabilities.SortieDepuis("Amplificateur"));
    }

    [TestMethod]
    public void LeReglageSeRelitTelQuIlAEteEcrit()
    {
        foreach (var sortie in new[] { SortieAudio.Stereo, SortieAudio.Surround51, SortieAudio.Surround71, SortieAudio.Amplificateur })
        {
            Assert.AreEqual(sortie, ClientCapabilities.SortieDepuis(ClientCapabilities.NomDe(sortie)));
        }
    }

    [TestMethod]
    public void LIndexDeSousTitresNegatifSignifieAucunSousTitre()
    {
        var sans = ClientCapabilities.Pour(1920, 1080, false, SortieAudio.Stereo, audioStreamIndex: 1, subtitleStreamIndex: -1);
        Assert.IsNull(sans.subtitleStreamIndex);
        Assert.AreEqual(1, sans.audioStreamIndex);

        var avec = ClientCapabilities.Pour(1920, 1080, false, SortieAudio.Stereo, subtitleStreamIndex: 3);
        Assert.AreEqual(3, avec.subtitleStreamIndex);
    }
}
