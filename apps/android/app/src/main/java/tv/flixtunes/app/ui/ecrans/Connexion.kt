package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.DiscoveredServer
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BoutonPrimaire
import tv.flixtunes.app.ui.Erreur
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.MarqueFlixTunes
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.RayonCommande
import tv.flixtunes.app.ui.indicationFocus
import tv.flixtunes.app.ui.rememberSourceFocus

@Composable internal fun EcranConnexion(
    servers: List<DiscoveredServer>, loading: Boolean, error: String?,
    connect: (String, String, String) -> Unit,
) {
    val gabarit = LocalGabarit.current
    var address by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Spacer(Modifier.height(30.dp))
        Accroche(stringResource(R.string.connexion_detectes))
        Text(
            stringResource(R.string.connexion_titre),
            Modifier.padding(top = 8.dp),
            fontSize = gabarit.tailleTitre.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheTitre,
        )
        Text(stringResource(R.string.connexion_aide), color = Muet)
        Spacer(Modifier.height(22.dp))
        OutlinedTextField(
            address, { address = it }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_exemple)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (address.isNotBlank() && !loading) connect(address, username, password) }),
            singleLine = true,
            shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.connexion_compte_distant_aide), color = Muet, fontSize = 12.sp,
            modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            username, { username = it.take(64) }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_identifiant)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), singleLine = true,
            shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            password, { password = it }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_mot_de_passe)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (address.isNotBlank() && !loading) connect(address, username, password) }),
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            singleLine = true, shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(12.dp))
        BoutonPrimaire(stringResource(R.string.connexion_valider), { connect(address, username, password) }, actif = address.isNotBlank() && !loading)
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(12.dp))
        if (servers.isNotEmpty()) {
            Text(stringResource(R.string.connexion_detectes), Modifier.padding(top = 20.dp, bottom = 8.dp), color = Muet)
            servers.forEach { server ->
                val source = rememberSourceFocus()
                OutlinedButton(
                    { connect(server.url, "", "") },
                    Modifier.indicationFocus(source, 12),
                    interactionSource = source,
                ) {
                    Text("${server.name} · ${server.url}")
                }
            }
        }
    }
}
