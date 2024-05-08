// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, Divider, FormHelperText } from '@mui/material';
import { createElement as h, Fragment, useEffect, useRef } from 'react';
import { apiCall, useApiEx } from './api'
import { state, useSnapState } from './state'
import { Link as RouterLink } from 'react-router-dom'
import { CardMembership, EditNote, Refresh, Warning } from '@mui/icons-material'
import { Dict, MAX_TILE_SIZE, REPO_URL, isIpLocalHost, wait, with_, try_, ipForUrl, SORT_BY_OPTIONS, THEME_OPTIONS,
    CFG, md } from './misc'
import { iconTooltip, InLink, LinkBtn, modifiedProps, wikiLink, useBreakpoint, NetmaskField, WildcardsSupported } from './mui'
import { Form, BoolField, NumberField, SelectField, FieldProps, Field, StringField } from '@hfs/mui-grid-form';
import { ArrayField } from './ArrayField'
import FileField from './FileField'
import { alertDialog, confirmDialog, newDialog, toast, waitDialog } from './dialog'
import { proxyWarning } from './HomePage'
import _ from 'lodash';
import { proxy, subscribe, useSnapshot } from 'valtio'
import { TextEditorField } from './TextEditor'

let loaded: Dict | undefined
let exposedReloadStatus: undefined | (() => void)
const pageState = proxy({
    changes: {} as Dict
})

//subscribeKey is not working (anymore) on nested changes
subscribe(state, (ops) => {
    if (ops.some(op => op[1][0] === 'config'))
        recalculateChanges()
})

export default function OptionsPage() {
    const { data, reload: reloadConfig, element } = useApiEx('get_config', { omit: ['vfs'] })
    const snap = useSnapState()
    const { changes } = useSnapshot(pageState)
    const statusApi  = useApiEx(data && 'get_status')
    const status = statusApi.data
    const reloadStatus = exposedReloadStatus = statusApi.reload
    useEffect(() => void reloadStatus(), [data]) //eslint-disable-line
    useEffect(() => () => exposedReloadStatus = undefined, []) // clear on unmount
    const sm = useBreakpoint('sm')

    const admins = useApiEx('get_admins').data?.list

    if (element)
        return element
    if (statusApi.error)
        return statusApi.element
    const values = (loaded !== data) ? (state.config = loaded = data) : snap.config
    const maxSpeedDefaults = {
        comp: NumberField,
        min: 1,
        unit: "KB/s",
        placeholder: "no limit",
        sm: 6,
    }
    const maxDownloadsDefaults = {
        comp: NumberField,
        min: 0,
        placeholder: "no limit",
        toField: (x: any) => x || '',
        sm: 4,
    }
    const httpsEnabled = values.https_port >= 0
    return h(Form, {
        sx: { maxWidth: '60em' },
        values,
        set(v, k) {
            state.config[k] = v
        },
        stickyBar: true,
        onError: alertDialog,
        save: {
            onClick: save,
            ...modifiedProps( Object.keys(changes).length>0),
        },
        barSx: { gap: 2 },
        addToBar: [
            h(Button, {
                onClick() {
                    reloadConfig()
                    reloadStatus()
                },
                startIcon: h(Refresh),
            }, "Reload"),
            h(Button, { // @ts-ignore
                component: RouterLink,
                to: "/edit",
                startIcon: h(EditNote),
            }, sm ? "Edit config file" : "File"),
        ],
        defaults() {
            return { sm: 6 }
        },
        fields: [
            h(Section, { title: "Networking" }),
            { k: 'port', comp: PortField, label:"HTTP port", status: status?.http||true, suggestedPort: 80 },
            { k: 'https_port', comp: PortField, label: "HTTPS port", status: status?.https||true, suggestedPort: 443,
                onChange(v: number) {
                    if (v >= 0 && !httpsEnabled && !values.cert)
                        void suggestMakingCert()
                    return v
                }
            },
            httpsEnabled && { k: 'cert', comp: FileField, sm: 4, label: "HTTPS certificate file",
                helperText: wikiLink('HTTPS#certificate', "What is this?"),
                error: with_(status?.https.error, e => isCertError(e) && (
                    status.https.listening ? e
                        : [e, ' - ', h(LinkBtn, { key: 'fix', onClick: suggestMakingCert }, "make one")] )),
            },
            httpsEnabled && { k: 'private_key', comp: FileField, sm: 4, label: "HTTPS private key file",
                ...with_(status?.https.error, e => isKeyError(e) ? { error: true, helperText: e } : null)
            },

            httpsEnabled && { k: 'force_https', comp: BoolField, label: "Force HTTPS", sm: 4, disabled: !httpsEnabled || values.port < 0,
                helperText: "Not applied to localhost"
            },

            { k: 'listen_interface', comp: SelectField, sm: 4, options: [{ label: "any", value: '' }, '127.0.0.1', '::1', ...status?.ips||[]] },
            { k: 'max_kbps',        ...maxSpeedDefaults, sm: 4, label: "Limit output", helperText: "Doesn't apply to localhost" },
            { k: 'max_kbps_per_ip', ...maxSpeedDefaults, sm: 4, label: "Limit output per-IP" },

            { k : CFG.max_downloads, ...maxDownloadsDefaults, helperText: "Number of simultaneous downloads" },
            { k : CFG.max_downloads_per_ip, ...maxDownloadsDefaults, label: "Max downloads per-IP" },
            { k : CFG.max_downloads_per_account, ...maxDownloadsDefaults, label: "Max downloads per-account", helperText: "Overrides other limits" },

            { k: 'admin_net', comp: NetmaskField, label: "Admin-panel accessible from", placeholder: "any address",
                helperText: h(Fragment, {}, "IP address of browser machine. ", h(WildcardsSupported))
            },
            { k: 'localhost_admin', comp: BoolField, label: "Unprotected admin on localhost",
                getError: x => !x && admins?.length===0 && "First create at least one admin account",
                helperText: "Access Admin-panel without entering credentials"
            },

            { k: 'proxies', comp: NumberField, min: 0, max: 9, label: "Number of HTTP proxies",
                error: proxyWarning(values, status),
                helperText: "Wrong number will prevent detection of users' IP address"
            },
            { k: 'allowed_referer', placeholder: "any", label: "Links from other websites", comp: AllowedReferer, },

            { k: 'block', label: false, comp: ArrayField, prepend: true, sm: true,
                fields: [
                    { k: 'ip', label: "Blocked IP", sm: 6, required: true, helperText: h(WildcardsSupported) },
                    { k: 'expire', $type: 'dateTime', minDate: new Date(), sm: 6, helperText: "Leave empty for no expiration" },
                    {
                        k: 'disabled',
                        $type: 'boolean',
                        label: "Enabled",
                        toField: (x: any) => !x,
                        fromField: (x: any) => x ? undefined : true,
                        sm: 6,
                    },
                    { k: 'comment' },
                ],
            },

            h(Section, { title: "Front-end", subtitle: "Following options affect only the front-end" }),
            { k: 'file_menu_on_link', comp: SelectField, label: "Access file menu", md: 4,
                options: { "by clicking on file name": true, "by dedicated button": false  }
            },
            { k: 'title', md: 8, helperText: "You can see this in the tab of your browser" },

            { k: 'auto_play_seconds', comp: NumberField, xs: 6, sm: 3, min: 1, max: 10000, label: "Auto-play seconds delay" },
            { k: 'tile_size', comp: NumberField, xs: 6, sm: 3, min: 0, max: MAX_TILE_SIZE, label: "Default tiles size", helperText: "Zero = list mode" },
            { k: 'theme', comp: SelectField, xs: 6, sm: 3, options: THEME_OPTIONS },
            { k: 'sort_by', comp: SelectField, xs: 6, sm: 3, options: SORT_BY_OPTIONS },

            { k: 'invert_order', comp: BoolField, xs: 6, sm: 4, md: 3,  },
            { k: 'folders_first', comp: BoolField, xs: 6, sm: 4, md: 3,  },
            { k: 'sort_numerics', comp: BoolField, xs: 6, sm: 4, md: true,  label: "Sort numeric names" },
            { k: 'favicon', comp: FileField, placeholder: "None", fileMask: '*.png|*.ico|*.jpg|*.jpeg|*.gif|*.svg', sm: 12,
                helperText: "The icon associated to your website" },

            h(Section, { title: "Others" }),
            { k: 'dont_overwrite_uploading', comp: BoolField, sm: 4, md: 6, label: "Don't overwrite uploading",
                helperText: "Files will be numbered to avoid overwriting" },
            { k: 'delete_unfinished_uploads_after', comp: NumberField, sm: 4, md: 3, min : 0, unit: "seconds", placeholder: "Never",
                helperText: "Leave empty to never delete" },
            { k: 'min_available_mb', comp: NumberField, sm: 4, md: 3, min : 0, unit: "MBytes", placeholder: "None",
                label: "Min. available disk space", helperText: "Reject uploads that don't comply" },

            { k: 'keep_session_alive', comp: BoolField, sm: true, helperText: "Keeps you logged in while the page is left open and the computer is on" },
            { k: 'session_duration', comp: NumberField, sm: 4, md: 3, min: 5, unit: "seconds", required: true },
            { k: 'zip_calculate_size_for_seconds', comp: NumberField, sm: 4, md: 3, label: "Calculate ZIP size for", unit: "seconds",
                helperText: "If time is not enough, the browser will not show download percentage" },

            { k: 'descript_ion', comp: BoolField, label: "Enable comments", helperText: "In file DESCRIPT.ION" },
            { k: 'descript_ion_encoding', label: "Encoding of file DESCRIPT.ION", comp: SelectField, disabled: !values.descript_ion,
                options: ['utf8',720,775,819,850,852,862,869,874,808, ..._.range(1250,1257),10029,20866,21866] },

            { k: 'open_browser_at_start', comp: BoolField, label: "Open Admin-panel at start",
                helperText: "Browser is automatically launched with HFS"
            },
            { k: 'mime', comp: ArrayField, label: false, reorder: true, prepend: true, md: 6,
                fields: [
                    { k: 'k', label: "File mask", helperText: h(WildcardsSupported), $width: 1, $column: {
                        renderCell: ({ value, id }: any) => h('code', {},
                            value,
                            value === '*' && id < _.size(values.mime) - 1
                                && iconTooltip(Warning, md("Mime with `*` should be the last, because first matching row applies"), {
                                    color: 'warning.main', ml: 1
                                }))
                    } },
                    { k: 'v', label: "Mime type", placeholder: "auto", $width: 2,
                        toField: (x: any) => x === 'auto' ? '' : x, fromField: (x: string) => !x ? 'auto' : x.toLowerCase(),
                        helperText: "Leave empty to get automatic value", },
                ],
                toField: x => Object.entries(x || {}).map(([k,v]) => ({ k, v })),
                fromField: x => Object.fromEntries(x.map((row: any) => [row.k, row.v])),
            },
            { k: 'server_code', comp: TextEditorField, sm: 12, getError: v => try_(() => new Function(v) && null, e => e.message),
                helperText: md(`This code works similarly to [a plugin](${REPO_URL}blob/main/dev-plugins.md) (with some limitations)`)
            },

        ]
    })

    async function save() {
        if (_.isEmpty(changes))
            return toast("Nothing to save")
        const loc = window.location
        const keys = ['port','https_port']
        if (keys.every(k => changes[k] !== undefined))
            return alertDialog("You cannot change both http and https port at once. Please, do one, save, and then do the other.", 'warning')
        const working = [status?.http?.listening, status?.https?.listening]
        const onHttps = location.protocol === 'https:'
        if (onHttps) {
            keys.reverse()
            working.reverse()
        }
        const newPort = changes[keys[0]]
        const otherPort = values[keys[1]]
        const otherIsReliable = otherPort > 0 && working[1]
        const otherProtocol = onHttps ? 'http' : 'https'
        if (newPort < 0 && !otherIsReliable)
            return alertDialog("You cannot switch off this port unless you have a working fixed port for " + otherProtocol, 'warning')
        if (newPort === 0 && !otherIsReliable)
            return alertDialog("You cannot randomize this port unless you have a working fixed port for " + otherProtocol, 'warning')
        if (newPort > 0 && !await confirmDialog("You are changing the port and you may be disconnected"))
            return
        const certChange = 'cert' in changes || 'private_key' in changes
        if (onHttps && certChange && !await confirmDialog("You may disrupt https service, kicking you out"))
            return
        await apiCall('set_config', { values: changes })
        if (newPort !== undefined || changes.listen_interface && !(loc.hostname === 'localhost' && isIpLocalHost(changes.listen_interface))) {
            await alertDialog("You are being redirected but in some cases this may fail. Hold on tight!", 'warning')
            const host = ipForUrl(changes.listen_interface || loc.hostname)
            // we have to jump protocol also in case of random port, because we want people to know their port while using GUI
            return window.location.href = newPort <= 0 ? `${onHttps ? 'http:' : 'https:'}//${host}:${otherPort}${loc.pathname}`
                : `${loc.protocol}//${host}:${newPort || values[keys[0]]}${loc.pathname}`
        }
        const portChange = 'port' in changes || 'https_port' in changes
        setTimeout(reloadStatus, portChange || certChange ? 1000 : 0) // give some time to apply news
        Object.assign(loaded!, changes) // since changes are recalculated subscribing state.config, but it depends on 'loaded' to (which cannot be subscribed), be sure to update loaded first
        recalculateChanges()
        toast("Changes applied", 'success')
    }
}

function Section({ title, subtitle }: { title: string, subtitle?: string }) {
    return h(Divider, {}, h('h3', { style: { margin: 0 } }, title), h(Box, { fontSize: 'small' }, subtitle))
}

function recalculateChanges() {
    const o: Dict = {}
    if (state.config)
        for (const [k, v] of Object.entries(state.config))
            if (JSON.stringify(v) !== JSON.stringify(loaded?.[k]))
                o[k] = v
    pageState.changes = o
}

export function isCertError(error: any) {
    return /certificate/.test(error)
}

export function isKeyError(error: any) {
    return /private key/.test(error)
}

function PortField({ label, value, onChange, setApi, status, suggestedPort=1, error, helperText }: FieldProps<number | null>) {
    const lastCustom = useRef(suggestedPort)
    if (value! > 0)
        lastCustom.current = value!
    const selectValue = Number(value! > 0 ? lastCustom.current : value) || 0
    let errMsg = status?.error
    if (errMsg)
        if (isCertError(errMsg) || isKeyError(errMsg))
            errMsg = undefined // never mind, we'll show this error elsewhere
        else
            error = true
    return h(Box, {},
        h(Box, { display: 'flex' },
            h(SelectField as Field<number>, {
                sx: { flexGrow: 1 },
                label,
                error,
                value: selectValue,
                options: [
                    { label: "off", value: -1 },
                    { label: "random", value: 0 },
                    { label: "choose", value: lastCustom.current },
                ],
                onChange,
            }),
            value! > 0 && h(NumberField, {
                label: "Number",
                fullWidth: false,
                value,
                onChange,
                setApi,
                error,
                min: 1,
                max: 65535,
                helperText,
                sx: { minWidth: '5.5em' }
            }),
        ),
        status && h(FormHelperText, { error },
            status === true ? '...'
                : errMsg ?? (status?.listening && "Correctly working on port " + status.port) )
    )
}

function AllowedReferer({ label, value, onChange, error }: FieldProps<string>) {
    const yesNo = !value || value==='-'
    const example = 'example.com'
    return h(Box, { display: 'flex' },
        h(SelectField as Field<string>, {
            label,
            value: yesNo ? value : example,
            options: { "allow all": '', "forbid all": '-', "allow some": example, },
            onChange,
            error,
            sx: yesNo ? undefined : { maxWidth: '11em' },
        }),
        !yesNo && h(StringField, {
            label: "Domain to allow",
            value,
            placeholder: 'example.com',
            onChange,
            error,
            helperText: h(WildcardsSupported)
        })
    )
}

export async function suggestMakingCert() {
    return new Promise(resolve => {
        const { close } = newDialog({
            icon: CardMembership,
            title: "Get a certificate",
            onClose: resolve,
            Content: () => h(Box, { p: 1, lineHeight: 1.5, },
                h(Box, {}, "HTTPS needs a certificate to work."),
                h(Box, {}, "We suggest you to ", h(InLink, { to: 'internet', onClick: close }, "get a free but proper certificate"), '.'),
                h(Box, {}, "If you don't have a domain ", h(LinkBtn, { onClick: makeCertAndSave }, "make a self-signed certificate"),
                    " but that ", wikiLink('HTTPS#certificate', " won't be perfect"), '.' ),
            )
        })

        async function makeCertAndSave() {
            if (!window.crypto.subtle)
                return alertDialog("Retry this procedure on localhost", 'warning')
            const stop = waitDialog()
            try {
                await wait(50) // give time to start animation before cpu intensive task
                const saved = await apiCall('save_pem', await makeCert({}))
                stop()
                await apiCall('set_config', { values: saved })
                if (loaded) // when undefined we are not in this page
                    Object.assign(loaded, saved)
                setTimeout(exposedReloadStatus!, 1000) // give some time for backend to apply
                Object.assign(state.config, saved)
                close()
                await alertDialog("Certificate saved", 'success')
            }
            finally { stop() }
        }
    })
}

async function makeCert(attributes: Record<string, string>) {
    // this relies on having loaded node-forge/dist/forge.min.js
    const { pki } = (window as any).forge
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

    const attrs = Object.entries(attributes).map(x => ({ name: x[0], value: x[1] }))
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey)

    return {
        cert: pki.certificateToPem(cert),
        private_key: pki.privateKeyToPem(keys.privateKey),
    }
}
