package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.key
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Profile
import tv.flixtunes.app.data.ProfileGroup
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.Bleu
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.BlocFocalisable
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.Erreur
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.MarqueFlixTunes
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.Panneau
import tv.flixtunes.app.ui.PanneauHaut
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.PuceFiltre
import tv.flixtunes.app.ui.RayonAvatar
import tv.flixtunes.app.ui.RayonBoite
import tv.flixtunes.app.ui.RayonCommande
import tv.flixtunes.app.ui.cliquableAuFocus

internal val profileColors = listOf("#2968ff", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4")

@Composable internal fun EcranGroupes(
    groups: List<ProfileGroup>,
    select: (ProfileGroup) -> Unit,
    create: (String) -> Unit,
    update: (ProfileGroup, String) -> Unit,
    delete: (ProfileGroup) -> Unit,
    disconnect: () -> Unit,
    error: String?,
) {
    val gabarit = LocalGabarit.current
    var creating by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ProfileGroup?>(null) }
    var deleting by remember { mutableStateOf<ProfileGroup?>(null) }
    var name by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Accroche(stringResource(R.string.groupes_titre), Modifier.padding(top = 26.dp))
        Text(stringResource(R.string.groupes_sous_titre), Modifier.padding(top = 6.dp, bottom = 26.dp),
            fontSize = gabarit.tailleTitre.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            groups.forEach { group ->
                Column(Modifier.width(gabarit.largeurCarte.dp)) {
                    BlocFocalisable({ select(group) }, Modifier.fillMaxWidth(), RayonAvatar.value.toInt()) {
                        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar))
                            .background(Panneau), contentAlignment = Alignment.Center) {
                            Text(group.name.take(1).uppercase(), fontSize = 44.sp, fontFamily = PoliceTitre,
                                fontWeight = FontWeight.ExtraBold, color = BleuClair)
                        }
                        Text(group.name, Modifier.padding(top = 10.dp), maxLines = 1,
                            overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                    }
                    Row {
                        BoutonTexte({ editing = group; name = group.name }) {
                            Text(stringResource(R.string.profil_modifier), fontSize = 12.sp, color = BleuClair)
                        }
                        if (groups.size > 1) BoutonTexte({ deleting = group }) {
                            Text(stringResource(R.string.action_supprimer), fontSize = 12.sp, color = Erreur)
                        }
                    }
                }
            }
            BlocFocalisable({ creating = true; name = "" }, Modifier.width(gabarit.largeurCarte.dp), RayonAvatar.value.toInt()) {
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar)).background(Panneau),
                    contentAlignment = Alignment.Center) {
                    Text("+", fontSize = 44.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Muet)
                }
                Text(stringResource(R.string.groupe_ajouter), Modifier.padding(top = 10.dp), fontWeight = FontWeight.Bold)
            }
        }
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(top = 16.dp))
        BoutonTexte(disconnect, Modifier.padding(top = 28.dp)) { Text(stringResource(R.string.connexion_changer), color = Muet) }
    }
    if (creating || editing != null) AlertDialog(
        onDismissRequest = { creating = false; editing = null }, containerColor = PanneauHaut,
        title = { Text(if (editing == null) stringResource(R.string.groupe_nouveau) else stringResource(R.string.groupe_modifier)) },
        text = { OutlinedTextField(name, { name = it.take(32) }, label = { Text(stringResource(R.string.groupe_nom)) }, singleLine = true) },
        confirmButton = { Button({ editing?.let { update(it, name) } ?: create(name); creating = false; editing = null },
            enabled = name.isNotBlank()) { Text(stringResource(R.string.profil_enregistrer)) } },
        dismissButton = { TextButton({ creating = false; editing = null }) { Text(stringResource(R.string.action_annuler)) } },
    )
    deleting?.let { group -> AlertDialog(
        onDismissRequest = { deleting = null }, containerColor = PanneauHaut,
        title = { Text(stringResource(R.string.groupe_supprimer_titre, group.name)) },
        text = { Text(stringResource(R.string.groupe_supprimer_aide)) },
        confirmButton = { Button({ delete(group); deleting = null }) { Text(stringResource(R.string.action_supprimer)) } },
        dismissButton = { TextButton({ deleting = null }) { Text(stringResource(R.string.action_annuler)) } },
    ) }
}

/**
 * `.profile-panel` — le choix du profil, et sa modification.
 *
 * La modification n'existait que dans le client Web : sur Android, changer une couleur ou poser un
 * code PIN demandait de supprimer le profil et de le recréer, ce qui emporte tout l'historique.
 */
@Composable internal fun EcranProfils(
    group: ProfileGroup,
    profiles: List<Profile>,
    select: (Profile) -> Unit,
    unlock: (Profile, String) -> Unit,
    create: (String, String, String, String?, Boolean, Int?) -> Unit,
    update: (Profile, String, String, String, String?, String?, Boolean, Int?) -> Unit,
    delete: (Profile) -> Unit,
    backToGroups: () -> Unit,
    error: String?,
) {
    val gabarit = LocalGabarit.current
    var lockedProfile by remember { mutableStateOf<Profile?>(null) }
    var profileToDelete by remember { mutableStateOf<Profile?>(null) }
    var profileToEdit by remember { mutableStateOf<Profile?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pin by remember { mutableStateOf("") }
    val cardWidth = gabarit.largeurCarte.dp
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Accroche(stringResource(R.string.profils_titre), Modifier.padding(top = 26.dp))
        Text(
            group.name,
            Modifier.padding(top = 6.dp, bottom = 26.dp),
            fontSize = gabarit.tailleTitre.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheTitre,
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            items(profiles, key = { it.id }) { profile ->
                Column(Modifier.width(cardWidth)) {
                    BlocFocalisable(
                        onClick = { if (profile.protected) { lockedProfile = profile; pin = "" } else select(profile) },
                        modifier = Modifier.fillMaxWidth(),
                        arrondi = RayonAvatar.value.toInt(),
                    ) {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar))
                            .background(runCatching { Color(android.graphics.Color.parseColor(profile.avatarColor)) }.getOrDefault(Bleu)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            profile.name.take(1).uppercase(), fontSize = 44.sp,
                            fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Color.White,
                        )
                    }
                    Text(
                        (if (profile.protected) "🔒 " else "") + profile.name, Modifier.padding(top = 10.dp),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold,
                    )
                    Text(
                        if (profile.language == "fr-FR") "Français" else "English",
                        color = Muet, fontSize = 12.sp,
                    )
                    if (profile.isChild) Text(stringResource(R.string.profil_enfant_age, profile.age ?: 0), color = BleuClair, fontSize = 12.sp)
                    }
                    // Les commandes d'administration ne sont pas imbriquées dans la cible qui ouvre
                    // le profil : TalkBack et la télécommande rencontrent trois actions distinctes.
                    Row {
                        BoutonTexte({ profileToEdit = profile }) {
                            Text(stringResource(R.string.profil_modifier), fontSize = 12.sp, color = BleuClair)
                        }
                        // La suppression du dernier profil est refusée par le serveur : le bouton disparaît.
                        if (profiles.size > 1) BoutonTexte({ profileToDelete = profile }) {
                            Text(stringResource(R.string.action_supprimer), fontSize = 12.sp, color = Erreur)
                        }
                    }
                }
            }
            item {
                BlocFocalisable(
                    onClick = { creating = true },
                    modifier = Modifier.width(cardWidth),
                    arrondi = RayonAvatar.value.toInt(),
                ) {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar)).background(Panneau),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("+", fontSize = 44.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Muet)
                    }
                    Text(
                        stringResource(R.string.profil_ajouter), Modifier.padding(top = 10.dp),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(top = 16.dp))
        BoutonTexte(backToGroups, Modifier.padding(top = 28.dp)) {
            Text(stringResource(R.string.groupes_changer), color = Muet)
        }
    }
    lockedProfile?.let { profile ->
        AlertDialog(
            onDismissRequest = { lockedProfile = null },
            title = { Text(stringResource(R.string.profil_pin_de, profile.name)) },
            text = {
                OutlinedTextField(
                    pin, { value -> pin = value.filter(Char::isDigit).take(8) }, label = { Text("PIN") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            },
            confirmButton = {
                Button({ unlock(profile, pin); lockedProfile = null }, enabled = pin.length in 4..8) {
                    Text(stringResource(R.string.profil_deverrouiller))
                }
            },
            dismissButton = { TextButton({ lockedProfile = null }) { Text(stringResource(R.string.action_annuler)) } },
            containerColor = PanneauHaut,
            shape = RoundedCornerShape(RayonBoite),
        )
    }
    profileToDelete?.let { profile ->
        AlertDialog(
            onDismissRequest = { profileToDelete = null },
            title = { Text(stringResource(R.string.profil_supprimer_titre, profile.name)) },
            text = { Text(stringResource(R.string.profil_supprimer_avertissement)) },
            confirmButton = { Button({ delete(profile); profileToDelete = null }) { Text(stringResource(R.string.action_supprimer)) } },
            dismissButton = { TextButton({ profileToDelete = null }) { Text(stringResource(R.string.action_annuler)) } },
            containerColor = PanneauHaut,
            shape = RoundedCornerShape(RayonBoite),
        )
    }
    if (creating) DialogueProfil(
        existant = null,
        onDismiss = { creating = false },
        onValider = { name, color, language, newPin, _, isChild, age ->
            creating = false; create(name, color, language, newPin, isChild, age)
        },
    )
    profileToEdit?.let { profile ->
        DialogueProfil(
            existant = profile,
            onDismiss = { profileToEdit = null },
            onValider = { name, color, language, newPin, ancienPin, isChild, age ->
                profileToEdit = null
                update(profile, name, color, language, newPin, ancienPin, isChild, age)
            },
        )
    }
}

/**
 * Création et modification d'un profil, dans la même boîte.
 *
 * Les deux gestes remplissent exactement les mêmes champs : les écrire deux fois garantissait qu'un
 * ajout à l'un manquerait à l'autre — ce qui s'était déjà produit côté Web avant que le panneau ne
 * réunisse les deux.
 */
@Composable internal fun DialogueProfil(
    existant: Profile?,
    onDismiss: () -> Unit,
    onValider: (String, String, String, String?, String?, Boolean, Int?) -> Unit,
) {
    var name by remember { mutableStateOf(existant?.name ?: "") }
    var color by remember { mutableStateOf(existant?.avatarColor ?: profileColors.first()) }
    var language by remember { mutableStateOf(existant?.language ?: "fr-FR") }
    var pin by remember { mutableStateOf("") }
    var ancienPin by remember { mutableStateOf("") }
    var retirerPin by remember { mutableStateOf(false) }
    var isChild by remember { mutableStateOf(existant?.isChild ?: false) }
    var ageText by remember { mutableStateOf(existant?.age?.toString() ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanneauHaut,
        shape = RoundedCornerShape(RayonBoite),
        title = {
            Text(if (existant == null) stringResource(R.string.profil_nouveau) else stringResource(R.string.profil_modifier))
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).imePadding()) {
                OutlinedTextField(
                    name, { name = it.take(32) }, label = { Text(stringResource(R.string.profil_nom)) },
                    singleLine = true, shape = RoundedCornerShape(RayonCommande),
                )
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.profil_couleur), fontSize = 12.sp, color = Muet)
                FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    profileColors.forEachIndexed { index, value ->
                        val descriptionCouleur = stringResource(R.string.profil_couleur_numero, index + 1)
                        Box(
                            Modifier.size(48.dp)
                                .semantics {
                                    contentDescription = descriptionCouleur
                                    selected = value == color
                                }
                                .cliquableAuFocus(
                                    arrondi = 11,
                                    role = Role.RadioButton,
                                    selectionne = value == color,
                                ) { color = value },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier.size(34.dp).clip(RoundedCornerShape(11.dp))
                                    .background(runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Bleu))
                                    .border(if (value == color) 3.dp else 0.dp, Color.White, RoundedCornerShape(11.dp)),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.profil_langue), fontSize = 12.sp, color = Muet, modifier = Modifier.padding(end = 10.dp))
                    PuceFiltre(language == "fr-FR", { language = "fr-FR" }) { Text("Français") }
                    Spacer(Modifier.width(8.dp))
                    PuceFiltre(language == "en-US", { language = "en-US" }) { Text("English") }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isChild, onCheckedChange = { isChild = it; if (!it) ageText = "" })
                    Text(stringResource(R.string.profil_enfant))
                }
                if (isChild) {
                    OutlinedTextField(
                        ageText, { ageText = it.filter(Char::isDigit).take(2) },
                        label = { Text(stringResource(R.string.profil_age)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        supportingText = { Text(stringResource(R.string.profil_age_aide)) },
                    )
                    Spacer(Modifier.height(14.dp))
                }
                if (existant?.protected == true) {
                    OutlinedTextField(
                        ancienPin, { ancienPin = it.filter(Char::isDigit).take(8) },
                        label = { Text(stringResource(R.string.profil_pin_actuel)) },
                        singleLine = true, shape = RoundedCornerShape(RayonCommande),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    )
                    Spacer(Modifier.height(10.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                  OutlinedTextField(
                    pin, { pin = it.filter(Char::isDigit).take(8); retirerPin = false },
                    modifier = Modifier.weight(1f),
                    label = {
                        Text(
                            if (existant == null) stringResource(R.string.profil_pin_facultatif)
                            else stringResource(R.string.profil_pin_inchange),
                        )
                    },
                    singleLine = true, shape = RoundedCornerShape(RayonCommande),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                  )
                  if (existant?.protected == true) {
                    TextButton({ retirerPin = true; pin = "" }) {
                        Text(stringResource(R.string.profil_pin_retirer), color = Erreur, fontSize = 12.sp, maxLines = 1)
                    }
                  }
                }
                if (retirerPin) Text(stringResource(R.string.profil_pin_retrait_confirmer), color = Erreur, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(
                {
                    // Une chaîne vide n'est pas « pas de changement » : elle retirerait le code. Un
                    // champ laissé vide ne transmet donc rien du tout, et le code en place survit.
                    val nouveauPin = if (retirerPin) "" else pin.takeIf { it.length in 4..8 }
                    onValider(name, color, language, nouveauPin,
                        ancienPin.takeIf { existant?.protected == true && nouveauPin != null }, isChild, ageText.toIntOrNull())
                },
                enabled = name.isNotBlank() && (pin.isEmpty() || pin.length in 4..8) &&
                    (!isChild || ageText.toIntOrNull() in 0..17) &&
                    (existant?.protected != true || (!retirerPin && pin.isEmpty()) || ancienPin.length in 4..8),
            ) {
                Text(if (existant == null) "Créer" else stringResource(R.string.profil_enregistrer))
            }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.action_annuler)) } },
    )
}

/**
 * Réglages de lecture du profil actif.
 *
 * Le serveur et le lecteur Android appliquaient déjà toutes ces préférences, mais seul le client Web
 * pouvait les modifier. Cette boîte ne crée aucun réglage local divergent : elle enregistre le profil
 * puis le prochain lecteur reçoit les mêmes valeurs que le Web et la TV.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun DialogueReglagesLecture(
    profile: Profile,
    onDismiss: () -> Unit,
    onValider: (Profile) -> Unit,
) {
    val premierAudio = profile.preferredAudioLanguages.firstOrNull()?.lowercase()
    var ordreAudio by remember(profile.id) {
        mutableStateOf(
            when (premierAudio) {
                "original" -> "original-fr-en"
                "en", "eng" -> "en-original-fr"
                else -> "fr-en-original"
            },
        )
    }
    var sortieAudio by remember(profile.id) { mutableStateOf(profile.audioOutputMode) }
    var sousTitres by remember(profile.id) { mutableStateOf(profile.subtitleMode) }
    var normalisation by remember(profile.id) { mutableStateOf(profile.audioNormalization) }
    var modeNuit by remember(profile.id) { mutableStateOf(profile.nightMode) }
    var plageDynamique by remember(profile.id) { mutableStateOf(profile.dynamicRangePriority) }
    var reprise by remember(profile.id) { mutableStateOf(profile.resumeMode) }
    var retourReprise by remember(profile.id) { mutableStateOf(profile.resumeRewindSeconds.toString()) }
    var vitesse by remember(profile.id) { mutableStateOf(profile.defaultPlaybackRate.toString()) }
    var episodeSuivant by remember(profile.id) { mutableStateOf(profile.autoplayNext) }
    var limite by remember(profile.id) { mutableStateOf(profile.autoplayLimit.toString()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanneauHaut,
        shape = RoundedCornerShape(RayonBoite),
        title = { Text(stringResource(R.string.reglages_lecture_pour, profile.name)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ChoixDeroulant(
                    stringResource(R.string.reglages_audio_langues),
                    listOf(
                        "fr-en-original" to stringResource(R.string.reglages_audio_fr),
                        "original-fr-en" to stringResource(R.string.reglages_audio_original),
                        "en-original-fr" to stringResource(R.string.reglages_audio_en),
                    ),
                    ordreAudio,
                ) { ordreAudio = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_sortie_audio),
                    listOf(
                        "auto" to stringResource(R.string.reglages_sortie_auto),
                        "copy" to stringResource(R.string.reglages_sortie_copy),
                        "aac" to "AAC universel",
                        "ac3" to "Dolby Digital / AC-3",
                        "opus" to "Opus",
                    ),
                    sortieAudio,
                ) { sortieAudio = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_sous_titres_auto),
                    listOf(
                        "forced" to stringResource(R.string.reglages_sous_titres_forces),
                        "always" to stringResource(R.string.reglages_sous_titres_toujours),
                        "off" to stringResource(R.string.reglages_sous_titres_off),
                    ),
                    sousTitres,
                ) { sousTitres = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_plage_dynamique),
                    listOf(
                        "auto" to stringResource(R.string.reglages_plage_auto),
                        "dolbyvision" to "Dolby Vision",
                        "hdr10plus" to "HDR10+",
                        "hdr10" to "HDR10",
                        "hlg" to "HLG",
                        "sdr" to "SDR",
                    ),
                    plageDynamique,
                ) { plageDynamique = it }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PuceFiltre(normalisation, { normalisation = !normalisation }) {
                        Text(stringResource(R.string.reglages_normalisation))
                    }
                    PuceFiltre(modeNuit, { modeNuit = !modeNuit }) {
                        Text(stringResource(R.string.reglages_mode_nuit))
                    }
                    PuceFiltre(episodeSuivant, { episodeSuivant = !episodeSuivant }) {
                        Text(stringResource(R.string.reglages_episode_suivant))
                    }
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ChoixDeroulant(
                        stringResource(R.string.reglages_reprise),
                        listOf(
                            "continue" to stringResource(R.string.reglages_reprise_auto),
                            "ask" to stringResource(R.string.reglages_reprise_demander),
                            "restart" to stringResource(R.string.reglages_reprise_debut),
                        ),
                        reprise,
                    ) { reprise = it }
                    ChoixDeroulant(
                        stringResource(R.string.reglages_retour_reprise),
                        listOf("0", "5", "10", "20").map { secondes ->
                            secondes to if (secondes == "0") stringResource(R.string.reglages_aucun)
                            else pluralStringResource(R.plurals.reglages_secondes, secondes.toInt(), secondes.toInt())
                        },
                        retourReprise,
                    ) { retourReprise = it }
                    ChoixDeroulant(
                        stringResource(R.string.reglages_vitesse),
                        listOf("0.75", "1.0", "1.25", "1.5", "2.0").map { valeur ->
                            valeur to "${valeur.replace(".0", "").replace('.', ',')}×"
                        },
                        vitesse,
                    ) { vitesse = it }
                    if (episodeSuivant) ChoixDeroulant(
                        stringResource(R.string.reglages_limite),
                        listOf("1", "2", "3", "5", "10").map { valeur ->
                            valeur to pluralStringResource(R.plurals.reglages_episodes, valeur.toInt(), valeur.toInt())
                        },
                        limite,
                    ) { limite = it }
                }
            }
        },
        confirmButton = {
            Button({
                val languesAudio = when (ordreAudio) {
                    "original-fr-en" -> listOf("original", "fr", "en")
                    "en-original-fr" -> listOf("en", "original", "fr")
                    else -> listOf("fr", "en", "original")
                }
                onValider(
                    profile.copy(
                        preferredAudioLanguages = languesAudio,
                        preferredSubtitleLanguages = if (profile.language == "fr-FR") listOf("fr", "en") else listOf("en", "fr"),
                        subtitleMode = sousTitres,
                        audioOutputMode = sortieAudio,
                        audioNormalization = normalisation,
                        nightMode = modeNuit,
                        dynamicRangePriority = plageDynamique,
                        resumeMode = reprise,
                        resumeRewindSeconds = retourReprise.toInt(),
                        defaultPlaybackRate = vitesse.toFloat(),
                        autoplayNext = episodeSuivant,
                        autoplayLimit = limite.toInt(),
                    ),
                )
            }) { Text(stringResource(R.string.profil_enregistrer)) }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.action_annuler)) } },
    )
}
