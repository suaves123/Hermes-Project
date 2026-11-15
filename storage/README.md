# Hermes local storage

This folder holds persistent simulator state and full telemetry history. Keep it outside the web document root and writable by PHP. Each visitor's private simulation lives in `viewers/<id>/` (folders idle for 14 days are removed automatically). Do not delete it when upgrading if you want to preserve recorded history. No simulation data is included in the delivered package.
