// ==UserScript==
// @name         AIMod Helper
// @namespace    AIMod
// @author       reverse-norms.bsky.social
// @version      1.22
// @description  Userscript to enhance aimod.social operation
// @match        *://aimod.social/*
// @connect      bsky.app
// @icon         https://www.google.com/s2/favicons?sz=64&domain=aimod.social
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

// Label toggle keys: 1 = AI Imagery, 2 = Frequent, 3 = Occasional, 4 = PFP/Banner, 5 = Modified, 6 = Assisted
// ~ (Tilde)/Numpad-Enter = 'Submit & Next'
// T = HIVE Scan current preview (if extension installed) and WasItAI scan
// Q,W,E,R,A / 7,8,9,*,- = Preview Image 1,2,3,4,PfP,Banner (press same again to close preview)
// If account report, Q & 7 will open PFP pic, and W/8 banner

/***  References  ***/
var inputEnabled = true;

const ReportType = Object.freeze({
    Post: "profile",
    Profile: "post",
    Unknown: "unknown"
});

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
    isAIModLabel(label) { return AILabel.isForProfile(label) === true || AILabel.isForPost(label) === true; },
    getLabelReportType(label) {
        if(AILabel.isForPost(label)) { return ReportType.Post; }
        if(AILabel.isForProfile(label)) { return ReportType.Profile; }
        return ReportType.Unknown;
    }
});

const ActionType = Object.freeze({
    Acknowledge: "Acknowledge",
    Escalate: "Escalate",
    Label: "Label",
    Tag: "Tag",
    Mute: "Mute",
    Comment: "Comment",
    Appeal: "Appeal",
    SetPriorityScore: "Set Priority Score"
});


class KeyPress {
    constructor (keys, onPress = null, modifiers = { ctrl:false, alt:false, shift:false, meta:false })
    {
        this.keys = keys;
        this.onPress = onPress;
        this.modifiers = modifiers;
    }
    //To create a KeyPress object from a native input KeyboardEvent, such as provided by 'keydown' listener.
    static FromKeyboardEvent(evt)
    {
        return new KeyPress([evt.key], { ctrl: evt.ctrlKey, alt: evt.altKey, shift: evt.shiftKey, meta: evt.metaKey });
    }
    //Compare to other KeyPress object based on values, instead of object equality "=="
    IsSame(other)
    {
        if (other == null || other.constructor !== KeyPress) { return false; }
        return (this.keys.some(thisKey => other.keys.includes(thisKey))
                && this.modifiers.ctrl === other.modifiers.ctrl
                && this.modifiers.alt === other.modifiers.alt
                && this.modifiers.shift === other.modifiers.shift
                && this.modifiers.meta === other.modifiers.meta)
    }
}

// Can change what keys you want to use here, just replace the number with what key you want.
// Example of requiring CTRL to be held: KeyPress('6', ()=> toggleLabel(AILabel.Assisted), { ctrl:true, alt:false, shift:false, meta:false })
const KeyBinds = Object.freeze({
    Label_Assisted: new KeyPress(['6'], ()=> toggleLabel(AILabel.Assisted)),
    Label_Imagery: new KeyPress(['1'], ()=> toggleLabel(AILabel.Imagery)),
    Label_Modified: new KeyPress(['5'], ()=> toggleLabel(AILabel.Modified)),
    Label_UserAvatarOrBanner: new KeyPress(['4'], ()=> toggleLabel(AILabel.UserAvatarOrBanner)),
    Label_UserOcassional: new KeyPress(['3'], ()=> toggleLabel(AILabel.UserOcassional)),
    Label_UserFrequent: new KeyPress(['2'], ()=> toggleLabel(AILabel.UserFrequent)),
    SubmitReportNext: new KeyPress(['`','Enter'], clickSubmit),
    SubmitReport: new KeyPress(['.'], ()=> clickSubmit(false)),
    PreviewImg1: new KeyPress(['q','7'], ()=> toggleImgPreview(0)),
    PreviewImg2: new KeyPress(['w','8'], ()=> toggleImgPreview(1)),
    PreviewImg3: new KeyPress(['e','9'], ()=> toggleImgPreview(2)),
    PreviewImg4: new KeyPress(['r','+'], ()=> toggleImgPreview(3)),
    PreviewPFP: new KeyPress(['a','*'], ()=> toggleImgPreview(-1)),
    PreviewBanner: new KeyPress(['-'], ()=> toggleImgPreview(-2)),
    Peek: new KeyPress(['y','/'], ()=> safeClick(getPeekButton())),
    AIScanPreviewImg: new KeyPress(['t','0'], ()=> aiScan(getCurrentImgPreview()))
});


function getReportWindow() {
    return document.body.querySelector('[id^="headlessui-dialog-panel-"]');
}

function getImgPreviewWindow() {
    return document.body.querySelector('div.yarl__portal_open div.yarl__container');
}

async function getCurrentImgPreviewAsync() {
    return await awaitElem(document.body, 'div.yarl__portal_open div.yarl__container div.yarl__carousel_with_slides div.yarl__slide_current > img');
}

function getCurrentImgPreview() {
    let curImgPreview = getImgPreviewWindow()?.querySelector('div.yarl__carousel_with_slides div.yarl__slide_current > img');
    if(curImgPreview) { return curImgPreview; }
  //  return getEmbedImgElem();
    return null;
}

function getProfilePicElem() {
    let pfpElem = getReportWindow()?.querySelector('#mod-action-panel div.flex-shrink-0 > button :is(img[src*="/avatar/plain/did:"],img[src*="/banner/plain/did:"])');
    if(pfpElem && !pfpElem.hasAttribute('pfpSrc')) { pfpElem.setAttribute('pfpSrc', pfpElem.src); }
    return pfpElem;
}

function getEmbedImgElem() {
    return getReportWindow()?.querySelector('form#mod-action-panel div.rounded:has(button img[src*="/avatar/plain/did:"]) div.flex[class*="gap-"] > img');
}

async function getReportImgElem(index)
{
    const reportWindow = getReportWindow();
    const result = { elem:null, src: null, replaceSrc: false, type: ""};

    if(reportWindow)
    {
        if(index >= 0)
        {
            const imagesContainer = reportWindow.querySelectorAll('form#mod-action-panel div > figure > button > img[src*="img/feed_"]');
            if(imagesContainer != null && imagesContainer.length > 0)
            { //Return post image
                if(index < imagesContainer.length)
                {
                    result.type = "Image";
                    result.elem = imagesContainer[index];
                    result.src = result.elem.src;
                    return result;
                }
                index -= imagesContainer.length;
            }
            else
            {
                const embed = getEmbedImgElem();

                if(embed)
                {
                    if(index === 0)
                    {
                        let pfpElem = getProfilePicElem();
                        result.elem = pfpElem;
                        result.src = embed.src;
                        result.replaceSrc = true;
                        result.type = "Embed";
                        return result;
                    }
                    index -= 1; //If we didn't want Embed, subtract it like we would a normal image element to go back to pfp/banner select
                }

            }
        }

        let pfpElem = getProfilePicElem();
        if(pfpElem == null) { return result; }

        result.elem = pfpElem;
        result.type = "PFP";
        result.src = result.elem.src;
        result.replaceSrc = true;

        if(index === -2 || index > 0)
        { //Profile Pic
            let bannerSrc = await getProfileBanner(pfpElem);
            if(bannerSrc) {
                result.src = bannerSrc;
                result.type = "Banner";
            }
        }

        return result;
    }
    return result;
}


function getReportType()
{
    const peekBtn = getPeekButton();
    if(peekBtn) { return peekBtn.href.includes('/post/') ? ReportType.Post : ReportType.Profile; }
    return ReportType.Unknown;
}

function getReportDID()
{
    const subjectElem = getReportWindow()?.querySelector('form#mod-action-panel input#subject');
    if(subjectElem){ return subjectElem.value.replace('at://','').split('/')[0]; }
    return null;
}

function getPeekButton()
{
    return getReportWindow()?.querySelector('#mod-action-panel div.w-full p:has(> a[href^="/repositories/did"]) a[href*="bsky.app/profile/"]');
}

function getNextButtons()
{
    const reportWindow = getReportWindow();
    return Array.from(reportWindow?.querySelectorAll('form#mod-action-panel div.px-1 div:has(> button[type="submit"] > span) button'));
}

function getNextButton(goNext = false)
{
    const reportWindow = getReportWindow();
    return getNextButtons()?.find(span => span.innerText.startsWith(goNext ? "Submit" : "(S)ubmit"));
}

async function getProfileBanner(pfp)
{
    if(pfp == null) { console.warn("AIMod Helper: Couldn't find Profile Pic element..."); return; }
    if(pfp.hasAttribute('cachedbanner')) { return pfp.getAttribute('cachedbanner'); }
    else
    {
        let bannerSrc = null;
        setSubmitButtonsEnabled(false);
        const textBox = getCommentBox();
        let textContent = textBox.value;

        textBox.value = "Querying user banner URL... Please wait.";

        const profile = await getProfile(getReportDID());
        if(profile && Object.hasOwn(profile, 'banner'))
        {
            bannerSrc = profile.banner;
            pfp.setAttribute('cachedbanner', bannerSrc);
        }
        textBox.value = textContent;

        setSubmitButtonsEnabled(true);
        return bannerSrc;
    }
    return null;
}

function getCommentBox()
{
     return getReportWindow()?.querySelector('textarea[name="comment"]');
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
async function setAction(actionType)
{
    let reportWindow = getReportWindow();

    setSubmitButtonsEnabled(false);

    const actionDropdown = reportWindow.querySelector('div.relative[data-cy="mod-event-selector"]');
    let actionButton = actionDropdown.querySelector('button');
    if(actionButton.hasAttribute('data-open')) { safeClick(actionButton); }

    actionButton = await awaitElem(actionDropdown, 'button:not([data-open])');

    // Return since the current text on the button already matches our input ActionType
    if(actionButton.innerText == actionType) {
        setSubmitButtonsEnabled(true);
        return true;
    }

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
            await awaitElem(actionDropdown, 'button:not([data-open])');
            await sleep(0.100);
            actionButton.blur();
            setSubmitButtonsEnabled(true);
            return true;
        }
    }

    setSubmitButtonsEnabled(true);
    return false;
}

async function toggleLabel(label)
{
    const reportWindow = getReportWindow();
    setSubmitButtonsEnabled(false);
    const actionsIsSet = await setAction(ActionType.Label);
    if(actionsIsSet === true)
    {
        let labelsValue = await awaitElem(reportWindow, 'input#labels');
        const labelsContainer = await awaitElem(labelsValue.parentElement, 'div:has(> button)');

        if(labelsContainer == null) { setSubmitButtonsEnabled(true); return; }

        const reportType = getReportType();
        const labelReportType = AILabel.getLabelReportType(label);
       // const isProfileLabel = AILabel.isForProfile(label);
        let activeLabels = labelsValue.value.split(',');
        const labelWasActive = activeLabels.includes(label);
        const disableLabels = [];

        Array.from(labelsContainer.childNodes).forEach(button =>
        {
            const otherLabel = button.innerText;
            if(!AILabel.isAIModLabel(otherLabel)) { return; }
            //Don't try to activate label if it's not for this post type
            if(otherLabel == label && labelReportType == reportType) { safeClick(button); return; }
        ///Rest to check if we should disable other labels
            if(!activeLabels.includes(otherLabel)) { return; }
            //Special case to not disable secondary Profile
            if(reportType == ReportType.Profile)
            {
                if(otherLabel == AILabel.UserAvatarOrBanner
                   || (label == AILabel.UserAvatarOrBanner && AILabel.getLabelReportType(otherLabel) == ReportType.Profile)
                   || labelReportType == ReportType.Post) { return; } //Don't try to clear Profile labels if Post label key was hit

            } else if(labelReportType == ReportType.Profile) { return; }

            disableLabels.push(button);
        });
        disableLabels.forEach(labelBtn => {
            sleep(Math.random() * 0.06).then(() => safeClick(labelBtn)); //Hack by delaying to avoid multiple click events at once being rejected
        });
        await sleep(Math.random() * 0.13);
        setSubmitButtonsEnabled(true);
        if(label == AILabel.UserAvatarOrBanner)
        {
            activeLabels = labelsValue.value.split(',');
            const pfpLabelActive = activeLabels.includes(AILabel.UserAvatarOrBanner);
            await setPFPLinkInText(pfpLabelActive);
        }
    }
}

async function setPFPLinkInText(add)
{
    if(getReportType() != ReportType.Profile) { return; }

    const pfp = await getReportImgElem(-1);
    const textBox = getCommentBox();

    if(pfp && textBox)
    {
        let existingText = textBox.value;
        const pfpSrc = pfp.src;
        let bannerSrc = "No Banner";

        const bannerTemp = await getProfileBanner(pfp.elem);
        if(bannerTemp) { bannerSrc = bannerTemp; }

        const pfpString = `PFP: { ${pfpSrc} }`;
        const bannerString = `\nBANNER: { ${bannerSrc} }`;

        if(add) {
            existingText = existingText.trim();

            if(existingText.length > 0) { existingText += `\n`; }
            if(!textBox.value.includes(pfpSrc)){
                existingText += pfpString;
            }
            if(!textBox.value.includes(bannerSrc)){
                existingText += bannerString;
            }

            textBox.value = existingText;
        }
        else if (!add)
        {
            textBox.value = existingText.replace(pfpString, '').replace(bannerString, '');
        }

        let evt = new Event('input', { bubbles: true });
        textBox.dispatchEvent(evt);
        textBox.blur();
    }
}

async function clickSubmit(goNext = true, reportWindow = null)
{
    if(reportWindow == null) { reportWindow = getReportWindow(); }

    const submitNextButton = getNextButton(goNext);

    if(submitNextButton == null) {
        console.warn("AIMod Helper: Submit button not found. Script probably needs updating.");
        return;
    }
    if(submitNextButton.disabled) { return; }

    safeClick(getHiveWindow()?.querySelector('#hvaid-close-icon'));

    const commentBox = getCommentBox();


    // Submit our text as a Comment instead if it includes a link, so that it makes clickable links
    if(commentBox && commentBox.value.includes('https://'))
    {
        const comment = commentBox.value;
        commentBox.value = "";

        safeClick(getNextButton(false));
        setSubmitButtonsEnabled(false);
        await sleep(1.0);
        commentBox.value = comment;

    }
    await sleep(0.08);
    setSubmitButtonsEnabled(true);
    safeClick(submitNextButton);
}

async function toggleImgPreview(index)
{
    const targetImage = await getReportImgElem(index);

    if(targetImage.elem == null || targetImage.elem.nodeName != 'IMG') { return; }

    let clickElem = targetImage.elem;
    let targSrc = targetImage.src;
    let replacePreviewSrc = targetImage.replaceSrc;
    let imgPreview = getCurrentImgPreview();

    if(imgPreview)
    {
        if(imgPreview.src.split('/did:plc:').at(-1) == targSrc.split('/did:plc:').at(-1))
        {
            //Close the preview window if the same image preview button is pressed when it's already being viewed
            safeClick(getImgPreviewWindow().querySelector('div.yarl__toolbar > button'));
            return;
        }

        let targIsAccountMedia = targSrc.includes('/img/avatar/') || targSrc.includes('/img/banner/') || replacePreviewSrc;
        let prevIsAccountMedia = imgPreview.src.includes('/img/avatar/') || imgPreview.src.includes('/img/banner/') || imgPreview.hasAttribute('replaced');

        if(targIsAccountMedia != prevIsAccountMedia)
        { //If switching from previewing an Avatar and an Image, close the current preview, otherwise they get doubled up and interaction breaks
            safeClick(getImgPreviewWindow().querySelector('div.yarl__toolbar > button'));
        }

        safeClick(clickElem);
        await sleep(0.1);

        if(replacePreviewSrc)
        {
            imgPreview.style = "";
            imgPreview.src = targSrc;
            imgPreview.setAttribute('replaced', true);
        } else if (imgPreview.hasAttribute('replaced'))
        {
            imgPreview.src = targSrc;
            imgPreview.removeAttribute('replaced');
        }
    }
    else
    {
        safeClick(clickElem);
        if(replacePreviewSrc)
        {
            imgPreview = await getCurrentImgPreviewAsync();
            imgPreview.setAttribute('replaced', true);
            imgPreview.style = "";
            imgPreview.src = targSrc;
        }
   }
}

async function wasItAI(url)
{
	const resp = await fetch("https://wasitai.com/api/images/check-is-it-ai-url", {
	  "headers": {
		"accept": "*/*",
		"accept-language": "en-US,en;q=0.9",
		"content-type": "application/json;charset=UTF-8",
		"priority": "u=1, i"
	  },
	  "referrer": "https://wasitai.com/",
	  "referrerPolicy": "no-referrer",
	  "body": `{\"imageUrl\":\"${url}\"}`,
	  "method": "POST"
	});
    if(resp.ok){
        try
        {
            const result = await resp.json();
            return { success: true, result: result };
        } catch(e) {}
    }
    return {success: false, result: null};
}

function setupScanResultsElement(parent, titleText, srcURL)
{
    let existingContainer = parent.querySelector('div.ai-scan-container');
    if(existingContainer) {
        if(existingContainer.getAttribute('src-url') != srcURL) { existingContainer.remove(); }
        else { return existingContainer.getAttribute('scanObj'); }
    }
    const resultContainer = document.createElement('div');
    resultContainer.className = 'ai-scan-container';
    resultContainer.setAttribute('src-url', srcURL);
    const titleElem = document.createElement('p');
    titleElem.className = 'ai-scan-title';
    resultContainer.appendChild(titleElem);
    titleElem.innerText = titleText;
    const resultTextElem = document.createElement('p');
    resultTextElem.className = 'ai-scan-result-text';
    resultTextElem.innerText = "Scanning...";
    resultContainer.appendChild(resultTextElem);

    parent.appendChild(resultContainer);
    const scanObj = { container: resultContainer, title: titleElem, resultText: resultTextElem, scanning: false, success: false };
    resultContainer.setAttribute('scanObj', scanObj);
    return scanObj;
}

function aiScan(imgElem)
{
    if(imgElem == null || getHiveButton() == null) { return; } //HIVE likely not installed

    const srcImg = imgElem.src.replace('feed_thumbnail', 'feed_fullsize');
    safeClick(imgElem);

    if(imgElem.parentElement.classList.contains('yarl__slide')) {
        let imageType = "";
        imageType = imgElem.src.includes('/img/avatar/') ? "Avatar" : imageType;
        imageType = imgElem.src.includes('/img/banner/') ? "Banner" : imageType;

        const scanResultBox = setupScanResultsElement(imgElem.parentElement, `(take with grain of salt, many false positives)\n\nWasItAI.com ${imageType} Scan Results:`, srcImg);
        if(scanResultBox.scanning != true && scanResultBox.success != true)
        {
            scanResultBox.scanning = true;

            wasItAI(srcImg).then(scanRes => {
                scanResultBox.scanning = false;
                if(scanRes.result == null || !Object.hasOwn(scanRes.result,'classificationDescription'))
                {
                    scanResultBox.resultText.innerText = "Scan Failed...";
                    scanResultBox.success = false;
                }
                else
                {
                    scanResultBox.success = true;
                    let scanDescr = "  " + scanRes.result.classificationDescription;
                    scanResultBox.resultText.innerText = scanDescr;

                }
            });
         }
    }

    try
    {
        let hiveWindow = getHiveWindow();
        if(hiveWindow == null) { safeClick(getHiveButton()); }

        GM_xmlhttpRequest({
            method: 'GET',
            url: srcImg,
            responseType: 'blob',
            onload: ({ status, response }) => {
                if (status !== 200) { console.warn(`AIMod Helper: Error loading: ${srcImg}`); return; }
                if (getHiveButton() == null) { console.warn(`AIMod Helper: HIVE Image Scanner extension not installed. Context menu item will do nothing.`); return; }

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
                        if(hiveWindow == null) { console.warn("AIMod Helper: Couldn't find HIVE window after clicking open."); return; }

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


async function getProfile(did)
{
    try {
        let resp = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${did}`);

        if(!resp.ok) { return null; }

        const data = await resp.json();
        return data;

    } catch(e) { return null; }

    return null;
}

/***  EVENTS  ***/

function onKeyPressed(keyEvent)
{
    if (!inputEnabled || isTypingTextbox()) { return; }
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

function setSubmitButtonsEnabled(enabled)
{
    inputEnabled = enabled;
    getNextButtons()?.forEach(btn => { btn.disabled = !enabled });
}

function makeSrcFullsize(url)
{
    return url.replace('/img/feed_thumbnail/','/img/feed_fullsize/');
}

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

// *** STYLING ***//

GM_addStyle(`#mod-action-panel > .flex:has(input#subject[value^="did:plc"]):not(:has(input#subject[value*="feed.post/"])) div.max-w-xl p.mb-3 { color: hsl(0 65% 50% / 1) !important; }
.ai-scan-container {
 width: 350px;
 height: 100%;
 display: flex;
 position: absolute;
 flex-direction: column;
 margin-left: 76%;
 margin-right: 50px;
 padding-left: 50px;
 padding-top: 80px;
 align-self: self-end;
}
.ai-scan-container > p {
 color: white;
 display: flex;
 justify-self: flex-start;
 white-space: pre-wrap;
}
.ai-scan-result-text {
 color: #EEEEEE !important;
}
#mod-action-panel div[data-cy="label-list"] button > span {
 font-size: 1.4em;
 padding-top: 4px;
 padding-bottom: 6px;
}
form#mod-action-panel div:has(> button[type="submit"]) > button[disabled] {
 opacity: 20%;
}`);
