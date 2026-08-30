# Corrige la recherche d'outils de fpm sous Windows, sans toucher à la gemme installée.
#
# fpm cherche `tar`, `gzip` et `xz` ainsi — `lib/fpm/util.rb`, ligne 26 :
#
#     envpath = ENV["PATH"].split(":")
#     return envpath.select { |p| File.executable?(File.join(p, program)) }.any?
#
# Deux erreurs, et chacune suffit à tout faire échouer sur Windows. Le séparateur du `PATH` y est
# `;` et non `:` — découper sur `:` coupe « C:\Program Files\… » en « C » et « \Program Files\… ».
# Et un exécutable Windows porte une extension : `File.executable?("…/tar")` répond **faux** même
# quand `tar.exe` est là, à côté. Mesuré, les deux.
#
# fpm renonce donc avec « Need executable 'tar' to convert dir to deb », alors que l'outil est
# présent et fonctionnel. Ce n'est pas un manque, c'est une méprise.
#
# On rouvre le module et on redéfinit la méthode. Rien n'est écrit sur le disque, rien n'est modifié
# dans la gemme : la correction ne vaut que pour l'appel qu'on lance, et disparaît avec lui. Une
# mise à jour de fpm qui corrigerait le défaut rendrait simplement cette rustine sans effet.
#
# Chargé par `Relais-Fpm.ps1` au moyen de `ruby -r`, avant le script de fpm.
require "fpm"

module FPM
  module Util
    def program_in_path?(program)
      return false unless ENV["PATH"]
      ENV["PATH"].split(File::PATH_SEPARATOR).any? do |dossier|
        candidat = File.join(dossier, program)
        # Les extensions que Windows tient pour exécutables, et le nom nu pour les autres systèmes.
        File.executable?(candidat) || %w[.exe .bat .cmd .com].any? { |bout| File.executable?(candidat + bout) }
      end
    end
  end
end
