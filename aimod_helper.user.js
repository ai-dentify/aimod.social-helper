// ==UserScript==
// @name         AIMod Helper
// @namespace    AIMod
// @author       reverse-norms.bsky.social
// @version      1.1
// @description  Userscript to enhance aimod.social operation
// @match        *://aimod.social/*
// @connect      bsky.app
// @icon         https://www.google.com/s2/favicons?sz=64&domain=aimod.social
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// ==/UserScript==

// Default keys: 1 = AI Imagery, 2 = Frequent, 3 = Occasional, 4 = PFP/Banner, 5 = Modified, 6 = Assisted
// ~ (Tilde) = Submit & Next, T = HIVE Scan current preview (if extension installed)
// Q,W,E,R,A = Preview Image 1,2,3,4,PfP (press same again to close preview)


/***  References  ***/

const AILabel = Object.freeze({
    //Content Labels
    Assisted: "ai-assisted",
    Imagery: "ai-imagery",
    Modified: "ai-modified",
    //Profile Labels
    UserAvatarOrBanner: "ai-avatar-or-banner",
    UserOcassional: "user-occasional-ai-imagery",
    UserFrequent: "user-frequent-ai-imagery",
    isForProfile(label) { return label == AILabel.UserAvatarOrBanner || label == AILabel.UserOcassional || label == AILabel.UserFrequent; },
    isForPost(label) { return label == AILabel.Assisted || label == AILabel.Imagery || label == AILabel.Modified; },
    isAIModLabel(label) { return AILabel.isForProfile(label) === true || AILabel.isForPost(label) === true; }
});

const ActionType = Object.freeze({
    Acknowledge: "Acknowlege",
    Escalate: "Escalate",
    Label: "Label",
    Tag: "Tag",
    Mute: "Mute",
    Comment: "Comment",
    Appeal: "Appeal",
    SetPriorityScore: "Set Priority Score"
});


class KeyPress {
    constructor (key, onPress = null, modifiers = { ctrl:false, alt:false, shift:false, meta:false })
    {
        this.key = key;
        this.onPress = onPress;
        this.modifiers = modifiers;
    }
    //To create a KeyPress object from a native input KeyboardEvent, such as provided by 'keydown' listener.
    static FromKeyboardEvent(evt)
    {
        return new KeyPress(evt.key, { ctrl: evt.ctrlKey, alt: evt.altKey, shift: evt.shiftKey, meta: evt.metaKey });
    }
    //Compare to other KeyPress object based on values, instead of object equality "=="
    IsSame(other)
    {
        if (other == null || other.constructor !== KeyPress) { return false; }
        return (this.key == other.key
                && this.modifiers.ctrl === other.modifiers.ctrl
                && this.modifiers.alt === other.modifiers.alt
                && this.modifiers.shift === other.modifiers.shift
                && this.modifiers.meta === other.modifiers.meta)
    }
}

// Can change what keys you want to use here, just replace the number with what key you want.
// Example of requiring CTRL to be held: KeyPress('6', ()=> toggleLabel(AILabel.Assisted), { ctrl:true, alt:false, shift:false, meta:false })
const KeyBinds = Object.freeze({
    Label_Assisted: new KeyPress('6', ()=> toggleLabel(AILabel.Assisted)),
    Label_Imagery: new KeyPress('1', ()=> toggleLabel(AILabel.Imagery)),
    Label_Modified: new KeyPress('5', ()=> toggleLabel(AILabel.Modified)),
    Label_UserAvatarOrBanner: new KeyPress('4', ()=> toggleLabel(AILabel.UserAvatarOrBanner)),
    Label_UserOcassional: new KeyPress('3', ()=> toggleLabel(AILabel.UserOcassional)),
    Label_UserFrequent: new KeyPress('2', ()=> toggleLabel(AILabel.UserFrequent)),
    SubmitReportNext: new KeyPress('`', clickSubmit),
    PreviewImg1: new KeyPress('q', ()=> toggleImgPreview(0)),
    PreviewImg2: new KeyPress('w', ()=> toggleImgPreview(1)),
    PreviewImg3: new KeyPress('e', ()=> toggleImgPreview(2)),
    PreviewImg4: new KeyPress('r', ()=> toggleImgPreview(3)),
    PreviewPFP: new KeyPress('a', ()=> toggleImgPreview(-1)),
    HiveScanPreviewImg: new KeyPress('t', ()=> hiveScan(getCurrentImgPreview()))
});

function getReportWindow()
{
    return document.body.querySelector('[id^=headlessui-dialog-panel]');
}

function getImgPreviewWindow()
{
    return document.body.querySelector('div.yarl__portal_open div.yarl__container');
}

function getCurrentImgPreview()
{
    return getImgPreviewWindow()?.querySelector('div.yarl__carousel_with_slides div.yarl__slide_current > img');
}

function getReportImgElem(index)
{
    const reportWindow = getReportWindow();
    if(reportWindow)
    {
        if(index == -1)
        { //Profile Pic
            return reportWindow.querySelector('#mod-action-panel div.flex-shrink-0 > button > img[src*="/avatar/plain/did:"]');
        }
        const imagesContainer = reportWindow.querySelectorAll('form#mod-action-panel div > figure > button > img');
        if(imagesContainer == null || index >= imagesContainer.length)
        { //Return PFP instead for ease of use
            return reportWindow.querySelector('#mod-action-panel div.flex-shrink-0 > button > img[src*="/avatar/plain/did:"]');;
        }
        return imagesContainer[index];
    }
    return null;
}

function getHiveWindow() { return document.body.querySelector('#hvaid-popover-container'); };

function getHiveButton()
{
    if(document.hiveBtn != null) { return document._hiveBtn; }
    document._hiveBtn = document.body.querySelector('#hvaid-toggle-popover-icon');
    return document._hiveBtn;
}

getHiveButton();


/***  BEHAVIOR  ***/
async function setAction(actionType, reportWindow = null)
{
    if(reportWindow == null) { reportWindow = getReportWindow(); }

    const actionDropdown = reportWindow.querySelector('div.relative[data-cy="mod-event-selector"]');
    const actionButton = actionDropdown.querySelector('button');
    // Return since the current text on the button already matches our input ActionType
    if(actionButton.innerText == actionType) { return true; }

    let actionOptionsHolder = actionDropdown.querySelector('div[id^="headlessui-menu-items-"]');
    if(actionOptionsHolder == null)
    { //Click Action drop-down to make it show options
        safeClick(actionButton);
        actionOptionsHolder = await awaitElem(actionDropdown, 'div[id^="headlessui-menu-items-"]');
    }
    if(actionOptionsHolder)
    {
        const actionOptions = Array.from(actionOptionsHolder.childNodes);
        const actionOption = actionOptions.find(actionItem => actionItem.innerText.includes(actionType));
        if(actionOption) {
            safeClick(actionOption);
            return true;
        }
    }
    return false;
}

async function toggleLabel(label)
{
    const reportWindow = getReportWindow();

    if(await setAction(ActionType.Label, reportWindow) === true)
    {
        const labelsValue = await awaitElem(reportWindow, 'input#labels');
        const labelsContainer = await awaitElem(labelsValue.parentElement, 'div:has(> button)');
        if(labelsContainer == null) { return; }

        const isProfileLabel = AILabel.isForProfile(label);
        const activeLabels = labelsValue.value.split(',');
        const disableLabels = [];

        Array.from(labelsContainer.childNodes).forEach(button =>
        {
            const otherLabel = button.innerText;

            if(otherLabel == label) { safeClick(button); return; }
            else if(!activeLabels.includes(otherLabel) || !AILabel.isAIModLabel(otherLabel)) { return; }
            //Special case to not disable secondary Profile
            if(isProfileLabel && (otherLabel == AILabel.UserAvatarOrBanner || (label == AILabel.UserAvatarOrBanner && AILabel.isForProfile(otherLabel)))) { return; }

            disableLabels.push(button);

        });
        disableLabels.forEach(labelBtn => {
            sleep(Math.random() * 0.08).then(() => safeClick(labelBtn)); //Hack by delaying to avoid multiple click events at once being rejected
        });
    }
}

function clickSubmit(goNext = true, reportWindow = null)
{
    if(reportWindow == null) { reportWindow = getReportWindow(); }

    const submitNextButton = Array.from(reportWindow.querySelectorAll('form#mod-action-panel div.px-1:has(button[type="submit"]) button > span'))?.find(span => span.innerText.startsWith(goNext ? "Submit" : "(S)ubmit"));

    if (submitNextButton) {
        safeClick(submitNextButton);
        safeClick(getHiveWindow()?.querySelector('#hvaid-close-icon'));
    } else {
        console.warn("AI Hitter: Submit button not found. Script probably needs updating.");
    }
}

function toggleImgPreview(index)
{
    const targetImage = getReportImgElem(index);
    if(targetImage == null) { return; }
    const imgPreview = getCurrentImgPreview();

    if(imgPreview && imgPreview.src.split('/did:plc:').at(-1) == targetImage.src.split('/did:plc:').at(-1))
    {
        //Close the preview window if the same image preview button is pressed when it's already being viewed
        safeClick(getImgPreviewWindow().querySelector('div.yarl__toolbar > button'));
    }
    else { safeClick(targetImage); }
}

function hiveScan(imgElem)
{
    if(imgElem == null || getHiveButton() == null) { return; } //HIVE likely not installed

    const srcImg = imgElem.src.replace('feed_thumbnail', 'feed_fullsize');
    safeClick(imgElem);

    try
    {
        let hiveWindow = getHiveWindow();
        if(hiveWindow == null) { safeClick(getHiveButton()); }

        GM_xmlhttpRequest({
            method: 'GET',
            url: srcImg,
            responseType: 'blob',
            onload: ({ status, response }) => {
                if (status !== 200) { console.warn(`AI Hitter: Error loading: ${srcImg}`); return; }
                if (getHiveButton() == null) { console.warn(`AI Hitter: HIVE Image Scanner extension not installed. Context menu item will do nothing.`); return; }

                let imgBlob = window.URL.createObjectURL(response);

                let c = document.createElement('canvas');
                var img = new Image();
                var ctx = c.getContext('2d');
                img.onload = async function()
                {
                    c.width = img.width;
                    c.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    c.toBlob(async (png) =>
                             {
                        if(hiveWindow == null) { //Button might have been clicked, so wait for it to open instead
                            hiveWindow = await awaitElem(document.body, '#hvaid-popover-container', 4.0);
                        }
                        if(hiveWindow == null) { console.warn("AI Hitter: Couldn't find HIVE window after clicking open."); return; }

                        let hiveTextBox = await awaitElem(hiveWindow, '#hvaid-text-area,#hvaid-results-go-back-clear-button,#hvaid-error-go-back-button', 10.0);
                        if(hiveTextBox.id != "hvaid-text-area")
                        { //Text box is missing, so must be an existing result. Click to Try New first.
                            safeClick(hiveTextBox);
                            hiveTextBox = await awaitElem(hiveWindow, '#hvaid-text-area', 10.0);
                        }

                        //Prepare our image for simulated pasting
                        const imgFile = new File([png], 'image.png', {type: 'image/png'});
                        safeClick(hiveTextBox);

                        const scanImg = new window.DataTransfer();
                        scanImg.items.add(imgFile);
                        //Trigger simulated paste into HIVE window
                        hiveTextBox.dispatchEvent(new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: scanImg}));
                        hiveWindow = await awaitElem(document.body, '#hvaid-popover-container', 5.0); //Refresh our HIVE window reference in-case it recreates it on paste.

                        const hiveConfirmBtn = await awaitElem(hiveWindow, '#hvaid-submit-button-container button');
                        //Wait for it to actually load our data before trying to progress
                        await awaitElem(hiveWindow, '#hvaid-image-preview', 5.0);
                        await sleep(0.5); //Delay so we can visually see the right image was pasted
                        safeClick(hiveConfirmBtn); //Scan
                    }, "image/png", 1);
                };
                img.src = imgBlob;
            },
        });
    }
    catch (err) { console.log(err); };
}

/***  EVENTS  ***/

function onKeyPressed(keyEvent)
{
    if (isTypingTextbox()) { return; }
    const pressedKey = KeyPress.FromKeyboardEvent(keyEvent);

    for(const key in KeyBinds)
    {
        const bindKey = KeyBinds[key];
        if(bindKey.IsSame(pressedKey)) {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            bindKey.onPress();
            break;
        }
    }
}

document.addEventListener('keydown', onKeyPressed);


//***  UTILITY FUNCTIONS  ***//

function safeClick(elem)
{
    elem?.dispatchEvent(new PointerEvent('click', {bubbles: true, cancelable: true}));
}

function isTypingTextbox()
{
    // If these are active, don't process our hotkey input, since user is typing things.
    if (document.activeElement.nodeName != 'TEXTAREA' && document.activeElement.nodeName != 'INPUT'
        && !(document.activeElement.nodeName == 'DIV' && document.activeElement.isContentEditable)) {
        return false;
    }
    return true;
}

async function sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function findElem(rootElem, query, observer, resolve)
{
    const elem = rootElem.querySelector(query);
    if (elem)
    {
        observer?.disconnect();
        resolve(elem);
    }
    return elem;
}

async function awaitElem(root, query, timeout = 2.0, obsArguments = {childList: true, subtree: true, attributes: false})
{
    return new Promise((resolve, reject) =>
    {
        if (findElem(root, query, null, resolve)) { return; }
        let timedOut = false;
        // Watch for page element changes, quering again when things change, until we find what we want
        const rootObserver = new MutationObserver((mutes, obs) => {
            if(findElem(root, query, obs, resolve) == null && timedOut === true)
            {
                obs.disconnect();
                resolve(null);
            }
        });
        rootObserver.observe(root, obsArguments);
        sleep(timeout).then(() => { timedOut = true; });
    });
}
