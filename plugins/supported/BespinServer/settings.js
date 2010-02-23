/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Bespin.
 *
 * The Initial Developer of the Original Code is
 * Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Bespin Team (bespin@mozilla.com)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var catalog = require("bespin:plugins").catalog;

/**
 * Save the settings using the server.
 * This code has not been tested since reboot
 * @class
 */
exports.ServerPersister = SC.Object.extend({
    _loading: false,

    loadInitialValues: function(settings) {
        var files = catalog.getObject("files");
        var settingsFile = files.getObject("BespinSettings/settings");
        settingsFile.loadContents().then(function(result) {
            var data;
            try {
                data = JSON.parse(result.contents);
            } catch (e) {
                console.error("Unable to parse settings file: " + e);
                data = {};
            }

            this._loading = true;
            for (var setting in data) {
                try {
                    settings.set(setting, data[setting]);
                } catch (ex) {
                    console.error("Error setting", setting, data[setting], ex);
                }
            }
            this._loading = false;
        }.bind(this));
    },

    persistValue: function(settings, key, value) {
        // when we're in the middle of setting the initial values,
        // we don't care about change messages
        if (this._loading) {
            return;
        }

        // Aggregate the settings into a file
        var data = {};
        settings._getSettingNames().forEach(function(key) {
            data[key] = settings.get(key);
        });

        var files = catalog.getObject("files");
        var settingsFile = files.getObject("BespinSettings/settings");

        try {
            var settingsString = JSON.stringify(data);
        } catch (e) {
            console.error("Unable to JSONify the settings! " + e);
            return;
        }
        // Send it to the server
        settingsFile.saveContents(settingsString);
    }
});