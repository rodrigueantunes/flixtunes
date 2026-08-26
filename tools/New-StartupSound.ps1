<#
  La signature sonore FlixTunes.

  Trois grandeurs gouvernent ce fichier, et elles ne varient pas ensemble. Les confondre est
  l'erreur qui a produit les premieres versions.

    Le PUNCH est temporel.   Contraste entre le transitoire et le corps qui suit. Il s'obtient par
                             un temps de montee court et par du silence -- jamais en ajoutant de
                             l'aigu, jamais en montant le niveau.
    L'AGRESSIVITE est spectrale. Sharpness de Zwicker (poids de l'energie vers l'aigu, en acum) et
                             rugosite de Plomp-Levelt, maximale lorsque deux partiels sont separes
                             d'un quart de bande critique. Elle se baisse en assombrissant et en
                             ecartant les voix, sans rien perdre du punch.
    L'IDENTITE est timbrale.  Jakubowski (2017) et Dowling (1978) expliquent quel contour melodique
                             se retient -- l'arche, avec un ecart inhabituel au retournement -- mais
                             pas ce qui distingue une marque d'une autre. Cloches additives, impact
                             grave et longue reverberation : c'est la formule commune a tous les
                             logos de plateformes. Une melodie posee dessus reste generique.

  D'ou le parti pris de ce fichier : l'identite est portee par le timbre, pas par les notes.

    -- La melodie est une CORDE PINCEE, synthetisee par recursion facon Karplus-Strong : un bruit
       adouci enferme dans une ligne a retard longue d'une periode, filtre a chaque tour. Ce n'est
       pas une somme de sinusoides, c'est une corde qui vibre reellement, avec ses partiels qui
       s'eteignent dans le desordre. Aucun logo de plateforme ne sonne ainsi.
    -- « Flix » et « Tunes » sont le MEME INSTRUMENT. Une corde grave, pincee sur le choc, double
       l'impact : celui-ci n'annonce pas la melodie, il en est la premiere note.
    -- Une note LYDIENNE -- le si naturel, quatrieme degre hausse -- brode autour du do au point
       de retournement de l'arche. C'est la couleur du cinema, et c'est la note qu'on retient.
       Elle est jouee vite et amortie court : un si et un do qui se recouvrent occupent un quart
       de bande critique, exactement le maximum de rugosite.

  Duree 2,55 s : l'indice SoundOut 2025 situe l'optimum de memorisation entre deux et trois
  secondes. Le fichier est la source unique des trois clients -- Android et Windows lisent le
  WAV depuis leurs ressources, le client Web recoit la version AAC.
#>
param(
  # Broderie : fa4 - do5 - si4 - do5 - fa5 - re5. Une quinte, la broderie lydienne, le saut au
  #            sommet, la chute d'une tierce sur la sixte de l'accord. C'est la signature.
  # Arche    : fa4 - do5 - fa5 - re5. Le meme contour sans l'ornement. Plus sobre, moins signe.
  # Signe    : do5 - fa5. Deux notes. Le plus court, le moins distinctif.
  [ValidateSet("Broderie", "Arche", "Signe")]
  [string]$Variant = "Broderie",

  # Rendre le son a cet emplacement et s'arreter la, sans toucher aux ressources des clients.
  [string]$PreviewPath
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.IO;
using System.Text;

public static class FlixTunesSignature
{
    const int Rate = 48000;
    const double Duration = 2.55;
    const double Impact = 0.070;   // l'appel d'air occupe ce qui precede

    static uint noiseState;
    static double Noise()
    {
        noiseState = noiseState * 1664525u + 1013904223u;
        return (noiseState / 2147483648.0) - 1.0;
    }

    // --- La corde -----------------------------------------------------------------------------
    // Karplus-Strong. Une ligne a retard longue d'une periode, remplie de bruit, et moyennee a
    // chaque tour : le moyennage est un passe-bas, donc les partiels aigus meurent avant le
    // fondamental -- ce qui est exactement le comportement d'une corde reelle, et ce qu'aucune
    // somme de sinusoides ne reproduit sans qu'on le lui dicte partiel par partiel.
    //
    // Le bruit d'excitation est lui-meme adouci avant d'entrer : un bruit blanc pur donne une
    // corde qui claque, filtre il donne une corde pincee a la pulpe du doigt. C'est la difference
    // entre percutant et agressif, a nouveau, et elle se joue ici sur un seul coefficient.
    static void Pluck(double[] cible, int depart, double freq, double decay, double eclat, double niveau)
    {
        // Le retard de boucle doit valoir exactement une periode. Il se compose du retard entier,
        // du retard de groupe du filtre de boucle, et d'un passe-tout du premier ordre qui rattrape
        // la fraction restante. Sans ce dernier, la ligne ne peut sonner que des frequences en
        // rapport entier avec la frequence d'echantillonnage : les notes tombaient a six centiemes
        // de ton de leur hauteur, et le re5 pince battait a six hertz contre le re5 tenu. Un
        // unisson faux est ce que l'oreille supporte le moins -- c'etait la source principale de
        // rugosite mesuree sur la queue.
        double periode = Rate / freq;
        const double Boucle = 0.62;              // ponderation du filtre de boucle : plus haut, plus sombre
        int n = (int)Math.Floor(periode - Boucle);
        if (n < 2 || depart >= cible.Length) return;
        double fraction = periode - Boucle - n;
        double coefficient = (1 - fraction) / (1 + fraction);
        double[] ligne = new double[n];

        // L'excitation est filtree a un multiple de la hauteur jouee, jamais a une frequence fixe.
        // C'est le comportement d'une vraie corde -- une corde grave pincee ne produit pas d'aigu,
        // sa raideur ne le permet pas --, et c'est surtout ce qui evite le defaut propre a
        // Karplus-Strong : la premiere periode sort telle quelle, avant que la boucle n'ait filtre
        // quoi que ce soit. Sur une corde de fa2, cela fait onze millisecondes de bruit large
        // bande en pleine attaque. Non filtree, la corde doublait la sharpness du fichier entier.
        double coupure = Math.Min(2600.0, freq * eclat);
        double alpha = 1 - Math.Exp(-2 * Math.PI * coupure / Rate);
        double lp1 = 0, lp2 = 0, maximum = 0;
        for (int i = 0; i < n; i++) { lp1 += (Noise() - lp1) * alpha; lp2 += (lp1 - lp2) * alpha; ligne[i] = lp2; }
        for (int i = 0; i < n; i++) maximum = Math.Max(maximum, Math.Abs(ligne[i]));
        if (maximum <= 0) return;
        for (int i = 0; i < n; i++) ligne[i] /= maximum;

        // Le gain de boucle fixe le temps de chute : l'onde fait « freq » tours par seconde.
        double gain = Math.Exp(-1.0 / (freq * decay));
        double precedent = 0, entree = 0, sortie = 0;
        int index = 0;
        for (int i = depart; i < cible.Length; i++)
        {
            double courant = ligne[index];
            // Le moyennage est le passe-bas de la corde : les partiels aigus s'eteignent avant le
            // fondamental, ce qui est le comportement d'une corde reelle et ce qu'aucune somme de
            // sinusoides ne donne sans qu'on le lui dicte partiel par partiel.
            double filtre = (1 - Boucle) * courant + Boucle * precedent;
            precedent = courant;
            filtre *= gain;
            // Passe-tout d'accord fin.
            double ajuste = coefficient * filtre + entree - coefficient * sortie;
            entree = filtre; sortie = ajuste;
            ligne[index] = ajuste;
            index++; if (index == n) index = 0;
            cible[i] += courant * niveau;
        }
    }

    // La voix qui chante, glissee sous les deux dernieres notes. Une corde pincee ne fait que
    // decroitre des l'attaque : c'est ce qui rend une suite de pincements articulee mais seche.
    // Une sinusoide a montee lente, posee dessous, relie les notes et fait la ligne. Le vibrato,
    // cinq hertz, reste tres au-dessous des quinze ou commence la rugosite : il s'entend comme
    // une inflexion, et il ne s'installe qu'apres coup, comme chez un chanteur.
    static double Voice(double x, double freq, double decay, double vibrato)
    {
        if (x <= 0) return 0;
        double phase = 2 * Math.PI * freq * x;
        if (vibrato > 0) phase += vibrato * (1 - Math.Exp(-x / 0.30)) * Math.Sin(2 * Math.PI * 5.2 * x);
        double corps = Math.Sin(phase) + 0.20 * Math.Sin(2 * phase) + 0.06 * Math.Sin(3 * phase);
        return corps * (1 - Math.Exp(-x / 0.055)) * Math.Exp(-x / decay);
    }

    // --- Filtres et salle ---------------------------------------------------------------------
    static double[] HighPass(double[] input, double cutoff)
    {
        double[] output = new double[input.Length];
        double alpha = 1.0 / (1.0 + 2 * Math.PI * cutoff / Rate);
        double previousIn = 0, previousOut = 0;
        for (int i = 0; i < input.Length; i++)
        {
            double value = alpha * (previousOut + input[i] - previousIn);
            output[i] = value; previousIn = input[i]; previousOut = value;
        }
        return output;
    }

    static double[] LowPass(double[] input, double cutoff)
    {
        double[] output = new double[input.Length];
        double alpha = 1 - Math.Exp(-2 * Math.PI * cutoff / Rate);
        double state = 0;
        for (int i = 0; i < input.Length; i++) { state += (input[i] - state) * alpha; output[i] = state; }
        return output;
    }

    static double[] Comb(double[] input, int delay, double feedback, double damping)
    {
        double[] output = new double[input.Length];
        double[] buffer = new double[delay];
        double store = 0; int index = 0;
        for (int i = 0; i < input.Length; i++)
        {
            double value = buffer[index];
            store = value * (1 - damping) + store * damping;
            buffer[index] = input[i] + store * feedback;
            output[i] = value;
            index++; if (index == delay) index = 0;
        }
        return output;
    }

    static double[] Allpass(double[] input, int delay, double gain)
    {
        double[] output = new double[input.Length];
        double[] buffer = new double[delay];
        int index = 0;
        for (int i = 0; i < input.Length; i++)
        {
            double value = buffer[index];
            output[i] = value - input[i];
            buffer[index] = input[i] + value * gain;
            index++; if (index == delay) index = 0;
        }
        return output;
    }

    static readonly int[] CombDelay = { 1687, 1801, 1949, 2063 };
    static readonly int[] AllpassDelay = { 619, 431 };

    // Chute courte et amortissement eleve : une queue longue et brillante remplit les creux entre
    // les frappes, et c'est dans ces creux que le caractere percussif se mesure -- et s'entend.
    static double[] Room(double[] input, int spread)
    {
        double[] sum = new double[input.Length];
        for (int c = 0; c < CombDelay.Length; c++)
        {
            double[] tap = Comb(input, CombDelay[c] + spread, 0.720, 0.46);
            for (int i = 0; i < sum.Length; i++) sum[i] += tap[i] * 0.25;
        }
        for (int a = 0; a < AllpassDelay.Length; a++) sum = Allpass(sum, AllpassDelay[a] + spread, 0.5);
        // Dix-huit millisecondes de pre-delai : la salle arrive apres le choc, jamais dessus.
        int predelay = (int)(Rate * 0.018);
        double[] shifted = new double[sum.Length];
        for (int i = predelay; i < sum.Length; i++) shifted[i] = sum[i - predelay];
        return shifted;
    }

    static short Sample(double value)
    {
        double clamped = Math.Max(-1.0, Math.Min(1.0, value));
        return (short)Math.Round(clamped * 32767.0);
    }

    // fa2, fa3, si4 (le quatrieme degre hausse), do5, re5, fa5, la4, sol5
    const double F2 = 87.31, F3 = 174.61, F4 = 349.23, A4 = 440.00;
    const double B4 = 493.88, C5 = 523.25, D5 = 587.33, F5 = 698.46, G5 = 783.99;

    public static string Write(string path, string variant)
    {
        noiseState = 0x5EED1234u;
        int count = (int)(Rate * Duration);
        double[] left = new double[count];
        double[] right = new double[count];

        double[] onset, pitch, level, ring, eclat, chant, vibrato;
        if (variant == "Arche")
        {
            onset   = new double[] { 0.400, 0.530, 0.700, 0.920 };
            pitch   = new double[] { F4, C5, F5, D5 };
            level   = new double[] { 0.30, 0.30, 0.40, 0.52 };
            ring    = new double[] { 0.30, 0.26, 0.40, 1.45 };
            eclat   = new double[] { 4.4, 4.4, 4.6, 4.0 };
            chant   = new double[] { 0.00, 0.00, 0.16, 0.30 };
            vibrato = new double[] { 0.00, 0.00, 0.00, 0.30 };
        }
        else if (variant == "Signe")
        {
            onset   = new double[] { 0.420, 0.700 };
            pitch   = new double[] { C5, F5 };
            level   = new double[] { 0.34, 0.54 };
            ring    = new double[] { 0.28, 1.45 };
            eclat   = new double[] { 4.4, 4.6 };
            chant   = new double[] { 0.00, 0.30 };
            vibrato = new double[] { 0.00, 0.30 };
        }
        else
        {
            // La broderie. Une quinte pour ouvrir -- l'intervalle large qui fait le retournement
            // inhabituel de Jakubowski --, puis do, si, do en un eclair : la note lydienne passe
            // en quatre-vingt-dix millisecondes et se tait avant le do suivant, sinon les deux
            // occuperaient un quart de bande critique. Le saut au sommet, et la chute d'une
            // tierce sur re5, qui pose une sixte au-dessus de l'accord.
            onset   = new double[] { 0.400, 0.530, 0.620, 0.710, 0.850, 1.070 };
            pitch   = new double[] { F4, C5, B4, C5, F5, D5 };
            level   = new double[] { 0.30, 0.26, 0.23, 0.28, 0.42, 0.54 };
            ring    = new double[] { 0.28, 0.11, 0.09, 0.22, 0.38, 1.45 };
            eclat   = new double[] { 4.4, 4.5, 4.5, 4.5, 4.6, 4.0 };
            chant   = new double[] { 0.00, 0.00, 0.00, 0.00, 0.16, 0.32 };
            vibrato = new double[] { 0.00, 0.00, 0.00, 0.00, 0.00, 0.30 };
        }
        double chordAt = onset[onset.Length - 1] - 0.020;

        // --- Le motif, rendu a part : une corde a besoin de son propre historique.
        double[] melodyLeft = new double[count];
        double[] melodyRight = new double[count];
        double[] note = new double[count];
        for (int k = 0; k < onset.Length; k++)
        {
            Array.Clear(note, 0, count);
            int start = (int)(onset[k] * Rate);
            Pluck(note, start, pitch[k], ring[k], eclat[k], level[k]);
            if (chant[k] > 0)
            {
                for (int i = start; i < count; i++)
                    note[i] += Voice((i - start) / (double)Rate, pitch[k], ring[k] * 1.15, vibrato[k]) * chant[k];
            }
            // Ouverture legere et alternee ; la derniere note reste au centre, elle doit survivre
            // entiere a la somme des deux voies sur un haut-parleur unique.
            double pan = (k == onset.Length - 1) ? 0 : ((k % 2 == 0) ? -0.13 : 0.13);
            for (int i = start; i < count; i++)
            {
                melodyLeft[i] += note[i] * (1 - pan);
                melodyRight[i] += note[i] * (1 + pan);
            }
        }

        // --- La corde grave qui double le choc. C'est elle qui fait de l'impact la premiere note
        // du motif plutot que son annonce : meme matiere, deux octaves plus bas.
        double[] centreBuffer = new double[count];
        Pluck(centreBuffer, (int)(Impact * Rate), F2, 0.45, 3.4, 0.18);

        double subPhase = 0, sub2 = 0, sub3 = 0, sub4 = 0, knockPhase = 0, knock2Phase = 0;
        double landPhase = 0, land2Phase = 0;
        double clickA = 0, clickB = 0, breathA = 0, breathB = 0;

        for (int i = 0; i < count; i++)
        {
            double t = (double)i / Rate;
            double x = t - Impact;

            // --- L'appel d'air. Soixante-dix millisecondes de souffle etouffe qui s'interrompt
            // net sur le choc. Rien ne rend un impact plus grand que le silence relatif qui le
            // precede : le contraste se mesure, l'energie ajoutee, non.
            double breath = 0;
            if (x < 0)
            {
                double u = t / Impact;
                breathA += (Noise() - breathA) * 0.020;
                breathB += (breathA - breathB) * 0.020;
                breath = breathB * 5.0 * u * u * 0.30;
            }

            double impact = 0, knock = 0, click = 0, body = 0;
            if (x >= 0)
            {
                // --- Le grave. Attaque en un demi-millieme de seconde, chute en 130 ms : ce qui
                // traine sous l'attaque ne s'entend pas comme du poids mais comme du flou, et
                // cela remplit le creux ou se joue le caractere percussif. Un impact court frappe
                // plus fort qu'un impact long.
                double subFreq = 44 + 120 * Math.Exp(-x / 0.065);
                subPhase += 2 * Math.PI * subFreq / Rate;
                sub2 += 2 * Math.PI * subFreq * 2 / Rate;
                sub3 += 2 * Math.PI * subFreq * 3 / Rate;
                sub4 += 2 * Math.PI * subFreq * 4 / Rate;
                double subEnv = (1 - Math.Exp(-x / 0.0005)) * (0.84 * Math.Exp(-x / 0.13) + 0.16 * Math.Exp(-x / 0.50));
                // Les harmoniques ne servent a rien au casque, et ce sont pourtant elles qui
                // portent : un haut-parleur de telephone ne descend pas a 44 Hz, et l'oreille
                // reconstruit le fondamental absent a partir de ses multiples.
                impact = (Math.Sin(subPhase) * 0.50 + Math.Sin(sub2) * 0.27
                        + Math.Sin(sub3) * 0.14 + Math.Sin(sub4) * 0.06) * subEnv;

                // --- Le knock, et c'est lui qui fait tout le punch. Une chute de 470 a 190 Hz :
                // dans cette bande une periode dure entre deux et cinq millisecondes, donc le
                // signal atteint sa crete presque immediatement -- alors qu'a 44 Hz il faut cinq
                // millisecondes rien que pour la premiere alternance. Et 470 Hz est trop grave
                // pour peser dans la sharpness. Du punch qui ne coute pas d'agressivite.
                double knockFreq = 190 + 280 * Math.Exp(-x / 0.022);
                knockPhase += 2 * Math.PI * knockFreq / Rate;
                knock = Math.Sin(knockPhase) * (1 - Math.Exp(-x / 0.0004)) * Math.Exp(-x / 0.030) * 0.62;
                // Un second knock une octave au-dessus, deux fois plus bref : le claquement du
                // bois sur la peau. Il vit entre 380 et 940 Hz et n'y sejourne que douze
                // millisecondes.
                knock2Phase += 2 * Math.PI * (380 + 560 * Math.Exp(-x / 0.014)) / Rate;
                knock += Math.Sin(knock2Phase) * (1 - Math.Exp(-x / 0.0002)) * Math.Exp(-x / 0.012) * 0.30;

                // --- Le transitoire. Deux poles a 2,2 kHz sur trois millisecondes. Une salve
                // aussi breve ne pese presque rien dans la sharpness, qui se calcule sur tout le
                // fichier, mais elle fait tomber le temps de montee sous la milliseconde.
                if (x < 0.04)
                {
                    double n = Noise();
                    clickA += (n - clickA) * 0.250;
                    clickB += (clickA - clickB) * 0.250;
                    click = clickB * 3.0 * Math.Exp(-x / 0.0030) * 0.75;
                }

                // --- Le corps frappe, deja en fa : trois voix consonantes, et rien qui traine.
                body = (Math.Sin(2 * Math.PI * F3 * x) * 0.50
                      + Math.Sin(2 * Math.PI * 261.63 * x) * 0.26
                      + Math.Sin(2 * Math.PI * F4 * x) * 0.15)
                     * (1 - Math.Exp(-x / 0.0015)) * Math.Exp(-x / 0.11) * 0.50;
            }

            // --- Le second coup, sous la note d'arrivee. Apres le vide, le motif ne se pose pas
            // sur du vent : un grave court le rattache a l'impact du debut.
            double landing = 0;
            double lx = t - chordAt;
            if (lx > 0)
            {
                double landFreq = 58 + 88 * Math.Exp(-lx / 0.045);
                landPhase += 2 * Math.PI * landFreq / Rate;
                land2Phase += 2 * Math.PI * landFreq * 2 / Rate;
                double landEnv = (1 - Math.Exp(-lx / 0.0006)) * Math.Exp(-lx / 0.16);
                landing = (Math.Sin(landPhase) * 0.40 + Math.Sin(land2Phase) * 0.20) * landEnv;
            }

            // --- L'accord d'arrivee : fondamentale, octave, tierce, et une neuvieme discrete.
            // Les ecarts entre voix voisines depassent tous la bande critique -- 2,5 entre fa3 et
            // la4, 2,75 entre la4 et sol5 --, donc rien n'est rugueux. La quinte a ete retiree :
            // do4 se tenait a 0,82 bande critique de fa3, et deux sinusoides si proches dans le
            // grave battent meme lorsque l'intervalle est consonant sur le papier. C'est la note
            // du motif qui pose la couleur au-dessus : re5, donc une sixte, moins conclusive
            // qu'un accord parfait -- l'oreille l'entend comme une ouverture, ce qui est le
            // sujet meme d'un son de demarrage.
            double padLeft = 0, padRight = 0;
            double px = t - chordAt;
            if (px > 0)
            {
                double swell = 1 - Math.Exp(-px / 0.11);
                double bas = swell * Math.Exp(-px / 0.90) * 0.32;
                double haut = swell * Math.Exp(-px / 1.40) * 0.32;
                double commun = Math.Sin(2 * Math.PI * F2 * px) * 0.28 * bas
                              + Math.Sin(2 * Math.PI * F3 * px) * 0.52 * bas;
                // Les voix aigues seules sont desaccordees d'un demi-hertz entre les canaux. Un
                // demi-hertz est une fluctuation, pas une rugosite : celle-ci ne commence qu'a
                // quinze. Le grave, lui, reste rigoureusement identique des deux cotes.
                padLeft = commun
                        + Math.Sin(2 * Math.PI * A4 * px) * 0.38 * haut
                        + Math.Sin(2 * Math.PI * G5 * px) * 0.15 * haut;
                padRight = commun
                         + Math.Sin(2 * Math.PI * 440.52 * px) * 0.38 * haut
                         + Math.Sin(2 * Math.PI * 784.61 * px) * 0.15 * haut;
            }

            double centre = breath + impact + knock + click + body + landing + centreBuffer[i];
            left[i] = centre + melodyLeft[i] + padLeft;
            right[i] = centre + melodyRight[i] + padRight;
        }

        double[] wetLeft = Room(HighPass(left, 220), 0);
        double[] wetRight = Room(HighPass(right, 220), 37);
        for (int i = 0; i < count; i++)
        {
            left[i] += wetLeft[i] * 0.15;
            right[i] += wetRight[i] * 0.15;
        }

        left = HighPass(left, 28); right = HighPass(right, 28);
        // Passe-bas a 5 kHz. Descendre plus bas ne change pas la sharpness mesuree -- elle vient du
        // medium qui definit la corde, pas du haut du spectre -- et ternirait le timbre pour rien.
        left = LowPass(left, 5000); right = LowPass(right, 5000);

        for (int i = 0; i < count; i++)
        {
            // Saturation douce plutot qu'ecretage : les sommets se tassent au lieu de se casser.
            left[i] = Math.Tanh(left[i] * 1.18);
            right[i] = Math.Tanh(right[i] * 1.18);
        }

        int fade = (int)(Rate * 0.11);
        for (int i = 0; i < fade; i++)
        {
            double g = 0.5 * (1 + Math.Cos(Math.PI * i / (double)fade));
            left[count - fade + i] *= g;
            right[count - fade + i] *= g;
        }

        double peak = 0, square = 0;
        for (int i = 0; i < count; i++)
        {
            peak = Math.Max(peak, Math.Max(Math.Abs(left[i]), Math.Abs(right[i])));
            square += left[i] * left[i] + right[i] * right[i];
        }
        // Le pic vise -3 dBFS, mais c'est le facteur de crete qui compte : a volume egal, un
        // fichier dynamique s'entend mieux et fatigue moins qu'un fichier tasse.
        double gain = peak > 0 ? 0.708 / peak : 1.0;

        using (FileStream stream = File.Create(path))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            int dataLength = count * 4;
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + dataLength);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
            writer.Write((short)1); writer.Write((short)2);
            writer.Write(Rate); writer.Write(Rate * 4);
            writer.Write((short)4); writer.Write((short)16);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(dataLength);
            for (int i = 0; i < count; i++)
            {
                writer.Write(Sample(left[i] * gain));
                writer.Write(Sample(right[i] * gain));
            }
        }

        double rms = Math.Sqrt(square / (count * 2)) * gain;
        return string.Format("{0:0.00} s, pic {1:0.0} dBFS, RMS {2:0.0} dBFS, crete {3:0.0} dB",
            Duration, 20 * Math.Log10(peak * gain), 20 * Math.Log10(rms),
            20 * Math.Log10(peak * gain) - 20 * Math.Log10(rms));
    }
}
"@

$projectRoot = Split-Path $PSScriptRoot -Parent

if ($PreviewPath) {
  $measure = [FlixTunesSignature]::Write($PreviewPath, $Variant)
  Write-Output ("{0} : {1}" -f $Variant, $measure)
  return
}

# Le WAV est rendu hors du dossier expedie : il sert de source aux trois clients, qui le lisent
# ensuite depuis leurs propres ressources.
$soundPath = Join-Path ([System.IO.Path]::GetTempPath()) "flixtunes-startup.wav"
$measure = [FlixTunesSignature]::Write($soundPath, $Variant)
Write-Output ("Signature FlixTunes ({0}) : {1}" -f $Variant, $measure)

$androidRaw = Join-Path $projectRoot "apps\android\app\src\main\res\raw"
$windowsAssets = Join-Path $projectRoot "apps\windows\Assets"
$webBrand = Join-Path $projectRoot "apps\web\public\brand"
[System.IO.Directory]::CreateDirectory($androidRaw) | Out-Null
[System.IO.File]::Copy($soundPath, (Join-Path $androidRaw "flixtunes_startup.wav"), $true)
[System.IO.File]::Copy($soundPath, (Join-Path $windowsAssets "flixtunes-startup.wav"), $true)

$webSound = Join-Path $webBrand "flixtunes-startup.m4a"
$webFallback = Join-Path $webBrand "flixtunes-startup.wav"
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  # 2,55 s de PCM pesent 478 Kio, expedies a chaque demarrage ; en AAC, environ 43 Kio.
  & ffmpeg -hide_banner -loglevel error -y -i $soundPath -c:a aac -b:a 128k -movflags +faststart $webSound
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg a echoue avec le code $LASTEXITCODE." }
  if (Test-Path $webFallback) { Remove-Item $webFallback }
  Write-Output ("Son de demarrage compresse : {0:N0} octets." -f (Get-Item $webSound).Length)
} else {
  # Sans encodeur, mieux vaut un son lourd qu'un son absent -- mais le budget le signalera.
  [System.IO.File]::Copy($soundPath, $webFallback, $true)
  Write-Warning "ffmpeg introuvable : le client Web embarque le WAV non compresse (voir apps/web/scripts/budgets.mjs)."
}
