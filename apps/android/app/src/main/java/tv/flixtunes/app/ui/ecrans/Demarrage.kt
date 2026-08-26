package tv.flixtunes.app.ui.ecrans

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.ApprocheEnseigne
import tv.flixtunes.app.ui.Bleu
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.EncreProfonde
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre

/**
 * `.brand-intro` — l'ouverture : le logo, l'enseigne en deux couleurs, une accroche.
 *
 * Le Web y ajoute une orbite tournante et un dégradé radial ; Android garde en plus sa barre de
 * progression, qui n'existe pas côté Web et qu'il serait dommage de perdre. Elle suit des étapes
 * réellement franchies — connexion, profils, médiathèque — et s'arrête donc si le serveur ne répond
 * pas, ce qui est une information utile plutôt qu'une animation rassurante et fausse.
 */
@Composable internal fun EcranDemarrage(step: StartupStep) {
    val gabarit = LocalGabarit.current
    val progress by animateFloatAsState(step.progress, animationSpec = tween(700), label = "progression")
    val apparition = remember { Animatable(0f) }
    LaunchedEffect(Unit) { apparition.animateTo(1f, tween(850)) }
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.radialGradient(listOf(Color(0xFF123A79), Encre, EncreProfonde))),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(gabarit.margeEcran.dp).alpha(apparition.value),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AsyncImageMarque(gabarit.tailleLogo.dp)
            Text(
                buildAnnotatedString {
                    append("Flix")
                    withStyle(SpanStyle(color = Color(0xFF72B9FF))) { append("Tunes") }
                },
                Modifier.padding(top = 14.dp),
                fontSize = gabarit.tailleEnseigne.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = ApprocheEnseigne,
            )
            Text(
                stringResource(R.string.intro_accroche),
                Modifier.padding(top = 4.dp),
                color = Muet,
                fontSize = gabarit.tailleTexte.sp,
            )
            Spacer(Modifier.height(28.dp))
            LinearProgressIndicator(
                { progress },
                Modifier.widthIn(max = 360.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                color = Bleu,
                trackColor = Color.White.copy(alpha = .1f),
                gapSize = 0.dp,
                drawStopIndicator = {},
            )
            Text(
                "${(progress * 100).roundToInt()} %", Modifier.padding(top = 12.dp),
                fontSize = gabarit.tailleSection.sp, fontWeight = FontWeight.Bold,
            )
            Text(stringResource(step.libelle), Modifier.padding(top = 4.dp), color = Muet, fontSize = gabarit.tailleTexte.sp)
        }
    }
}

/** Le seul logo de l'application, à la taille demandée. */
@Composable internal fun AsyncImageMarque(taille: Dp) {
    androidx.compose.foundation.Image(
        androidx.compose.ui.res.painterResource(R.drawable.flixtunes_mark),
        null,
        Modifier.size(taille),
    )
}
