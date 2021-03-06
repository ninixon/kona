/* Copyright (c) 2014, Victor Petrov <victor.petrov@gmail.com>. All rights reserved. License: BSD New (see license.txt for details). */
"use strict";

console.log('Kona JS v.1.0');

//setting this to false lets us load 'inflate.js' and 'deflate.js'
//directly via the extension
zip.useWebWorkers = false;

var progress_span = [],
    progress_id = 0,
    current_progress_el,
    download_in_progress = false,
    download_link,
    download_message,
    download_message_container,
    download_message_timer,
    filenames = [];

//requests a local filesystem of size 'bytes'
function getFS(bytes, success, error) {

    //choose which method to use
    var requestFileSystem = window.webkitRequestFileSystem || window.mozRequestFileSystem || window.requestFileSystem;

    if (!requestFileSystem) {
        error("Your browser doesn't support local filesystems");
        return;
    }

    //request local space
    requestFileSystem(window.TEMPORARY, bytes,
        //request filesystem succeeded
        function (fs) {
            //attempt to create a zip file entry
            fs.root.getFile("kona.zip", {create:true},
                function (file_handle) {
                    //The HTML5 FileWriter will append to the file if it exists
                    //so we first must attempt to truncate this file, otherwise
                    //we'll get corrupt zip files
                    file_handle.createWriter(function (writer) {
                        //called when writing is done
                        writer.onwriteend = function () {
                            zip.createWriter(new zip.FileWriter(file_handle), success, error);
                        }

                        //error handler
                        writer.onerror = window.onabort = function () {
                            error(writer.error);
                        }

                        //does this file need to be truncated?
                        if (writer.length > 0) {
                            //yes, truncate
                            writer.truncate(0);
                        } else {
                            //nope, proceed to creating the zip file
                            zip.createWriter(new zip.FileWriter(file_handle), success, error);
                        }
                    });
                });
        },
        //request filesystem error
        function (e) {
            if (error) {
                error(getFileError(e.code));
            }
        }
    );
}

function getActiveProjectElement() {
    //get the top level containers
    var containers = document.querySelectorAll('#content > .kona_project'),
        container,
        result;

    if (!containers || !containers.length) {
        return result;
    }

    //find a container that's visible
    var i,
        visible;

    for (i in containers) {
        if (containers.hasOwnProperty(i)) {
            container = containers[i];
            //is it visible?
            if (container.style.display.indexOf('none') < 0) {
                result = container;
                break;
            }
        }
    }

    return result;
}

function findDownloadableLinks(root) {
    //find all downloadable files
    return root.querySelectorAll('a.file_item.attachment_icon_link');
}

function addSelectAction() {
    var project = getActiveProjectElement();
    if (!project) {
        console.error("KonaJS: Failed to detect which project element is active.");
        return;
    }

    //find all downloadable files
    var links = findDownloadableLinks(project),
        link,
        link_parent,
        activity_container,
        select_el,
        i;

    if (!links || !links.length) {
        console.log("KonaJS: No downloadable links found.");
        return;
    }

    for (i = 0; i < links.length; ++i) {
        link = links[i];
        console.log("link", link);
        link_parent = link.parentElement.parentElement;
        console.log("link_parent", link_parent);
        activity_container = link_parent.querySelector('.activity_actions');
        console.log("activity_container", activity_container);

        if (!activity_container) {
            continue;
        }

        //<a class="select_action" title="Select"></a>
        select_el = document.createElement('a');
        select_el.classList.add("kona-select-action");
        select_el.setAttribute('title', 'Select');
        activity_container.appendChild(select_el);

        console.log('Appended ', select_el);
    }

}

//'Download all' button click handler. Requests a 4GB filesystem and starts
//downloading all the files.
function onDownloadAll() {

    if (download_in_progress) {
        showMessage("Please wait for the current download operation to finish.");
        return;
    }

    download_in_progress = true;
    //reset used filenames
    filenames = [];

    var project = getActiveProjectElement();

    if (!project) {
        console.error("KonaJS: Failed to detect which project element is active.");
        return;
    }

    var links = findDownloadableLinks(project);
    if (!links || !links.length) {
        console.error('KonaJS: No files to download');
        showMessage("We can't find any files to download.");
        return;
    }

    //request 4GB because we don't know how large the zip file is going to be
    getFS(4 * 1024 * 1024 * 1024,
        function (zip_file) {
            //start downloading all files
            downloadLinks(links, zip_file, function () {
                console.log('KonaJS: All files downloaded');
                zip_file.close(
                    function (blob) {
                        download_in_progress = false;
                        console.log('KonaJS: ZIP file ready for download.');
                        var blobURL = URL.createObjectURL(blob);

                        var clickEvent = document.createEvent("MouseEvent");
                        clickEvent.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
                        download_link.href = blobURL;
                        download_link.download = "kona.zip";
                        download_link.dispatchEvent(clickEvent);
                    });

            }, function (msg) {
                download_in_progress = false;
                showError(msg);
            });
        },
        function (msg) {
            download_in_progress = false;
            showError(msg);
        }
    );
}

//starts downloading a list of links
function downloadLinks(links, zip_file, success, error) {
    //addSelectAction(); //TODO: uncomment this
    return _downloadLinks(links, zip_file, 0, success, error);
}

//iteratively downloads all links in the list
function _downloadLinks(links, zip_file, current_link, success, error) {

    //if all links have been downloaded, hide all progress information
    //and call the success callback
    if (current_link >= links.length) {
        hideAllProgressInfo();
        success();
        return;
    }

    //download one link. when done, display a checkmark, recurse and increment current_link
    downloadLink(links[current_link], zip_file, function () {
        //display checkmark
        var progress = getProgressElement(links[current_link]) || createProgressElement(links[current_link]);
        progress.innerHTML = '<b>&#10003;</b>';

        //download next link
        _downloadLinks(links, zip_file, current_link + 1, success, error);
    }, error);
}

function getFilenameFromLink(link, fallback_filename, zip_file) {
    if (!link || !zip_file) {
        console.error("KonaJS: Cannot determine filename for invalid links and/or zip objects", link, zip_file);
        return fallback_filename;
    }

    var name_el = link.parentElement.parentElement.querySelector('.activity_name'),
        result = fallback_filename;

    if (!name_el) {
        return result;
    }

    return name_el.textContent || fallback_filename;
}

function preserveExtension(original, newname) {
    var original_ext = original.toLowerCase().split(".").pop(),
        new_ext = newname.toLowerCase().split(".").pop();

    if (original_ext && original_ext.length && original_ext !== new_ext) {
        return newname + "." + original_ext;
    }

    return newname;
}

function ensureUniqueFilename(file_name) {

    if (filenames.indexOf(file_name) >= 0) {
        var parts = file_name.split("."),
            name = "",
            ext = "";

        if (parts && parts.length > 1) {
            ext = parts.pop();
            name = parts.join(".")
        } else {
            name = file_name
        }

        console.log("[KonaJS] name=", name,"ext=",ext);

        //find a suitable number
        var newname, 
            counter = 1;

        do {
            newname = name + " (" + counter + ")";
            if (ext && ext.length) {
                newname += "." + ext
            }

            console.log('[KonaJS] Checking filename', newname)
            counter++;
        } while (filenames.indexOf(newname) >= 0);

        console.log('[KonaJS] New file name:', newname)
        file_name = newname;
    }

    filenames.push(file_name)

    return file_name;
}

//Calls the actual 'download' method that fetches the data from the server.
//When the data are ready, it is added to the zip file.
//The progress function relies on the download progress to already be at 50%,
//with the other 50% reserved for the zip_file.add() progress callback.
//That is, the first 50% represent download progress, the second 50% represent zipping progress.
//Zipping is performed with no compression for faster processing.
function downloadLink(link, zip_file, success, error) {
    //start by downloading the data
    download(link,
        //on download success
        function (data) {
            var path = data.url.pathname;
            var progress = getProgressElement(link) || createProgressElement(link);
            //extract the file name from the URL
            var fallback_filename = path.substr(path.lastIndexOf('/') + 1).trim(),
                file_name = getFilenameFromLink(link, fallback_filename, zip_file).trim();

            //attempt to preserve the original file extension, since users can name files arbitrarily
            file_name = preserveExtension(fallback_filename, file_name);
            file_name = ensureUniqueFilename(file_name)

            console.log('KonaJS: Adding', file_name);
            //add data to zip as 'file_name'
            zip_file.add(file_name, new zip.BlobReader(data.blob), success,
                //progress callback
                function (loaded, total) {
                    //second part of progress indicator
                    progress.innerHTML = Math.ceil(50.0 + (loaded / total) * 50.0) + '%';
                },
                //no compression
                {level: 0}
            );
        },
        //on download error
        function (reason) {
            console.error('KonaJS: Failed to download file from', link.href, reason.currentTarget.status);
            var message = 'connection failed.';

            if (reason instanceof XMLHttpRequestProgressEvent) {
                message = reason.error || reason.currentTarget.statusText || message;
            }

            error(message);
        }
    );

}

//Uses XMLHttpRequest to make a GET request and retrieve file data as a Blob
function download(link, success, error) {
    console.log('KonaJS: Downloading', link.href);
    var r = new XMLHttpRequest();
    r.responseType = "blob";
    r.onreadystatechange = function () {
        downloadStateChanged(link, r.readyState);

        if (r.readyState === XMLHttpRequest.DONE) {
            //download failed, rely on 'onerror' to be called by XMLHttpRequest
            if (r.response === null) {
                console.log('KonaJS: no data received for', link.href);
                return;
            }

            var result = {
                url: (new URL(link.href)),
                blob: r.response
            };

            success(result);
        }
    };

    //callbacks
    r.onprogress = updateDownloadProgress;
    r.onerror = error;

    r.open("GET", link.href, true);
    r.send();
}

//Hides the elements which display progress information.
function hideAllProgressInfo() {
    for (var i in progress_span) {
        if (progress_span.hasOwnProperty(i)) {
            progress_span[i].style.visibility = 'hidden';
        }
    }
}

//Creates a <span> element for displaying download/zipping progress.
//This element is cached in the progress_span list
//each progress element is assigned an ID which is stored as an
//attribute of the <a> link.
function createProgressElement(link) {
    var p = link.parentNode.parentNode,
        span = document.createElement('span');

    span.classList.add('kona-ext-progress');
    span.innerHTML = '0%';

    p.appendChild(span);

    progress_span[progress_id] = span;
    link.setAttribute('kona-progress', progress_id);
    progress_id++;

    return span;
}

//Returns an existing <span> progress element, or null otherwise
function getProgressElement(link) {
    var pid = link.getAttribute('kona-progress');

    if (pid === undefined || pid === null) {
        return null;
    }

    return progress_span[pid - 0];
}

//Computes the download progress. Downloading is only half the battle,
//so this progress indicator only goes up to 50%. The other 50% is the zipping
//procedure.
function updateDownloadProgress(e) {
    if (!current_progress_el || !e.lengthComputable) {
        return;
    }

    current_progress_el.innerHTML = Math.floor((e.loaded / e.total) * 50.0) + '%';
}

//When the XMLHttpRequest object changes its state, we show the progress element
function downloadStateChanged(link, state) {
    switch (state) {
        //unsent
        case XMLHttpRequest.UNSENT:
            break;
        case XMLHttpRequest.OPENED:
            current_progress_el = getProgressElement(link);
            if (!current_progress_el) {
                current_progress_el = createProgressElement(link);
            }
            current_progress_el.style.visibility = '';
            break;
        case XMLHttpRequest.HEADERS_RECEIVED:
            break;
        case XMLHttpRequest.LOADING:
            break;
        case XMLHttpRequest.DONE:
            break;
    }
}

//Set up the Download button and link, as well as the error message <span>
function attachToPage(el) {
    if (!el) {
        console.error('KonaJS: No element to attach to');
        return;
    }

    //'Download all' button
    var link = document.createElement('button');

    link.setAttribute('class', 'kona-download-button');
    link.innerHTML = 'Download all';
    link.addEventListener('click', onDownloadAll);

    el.appendChild(link);

    //show the extension icon
    chrome.runtime.sendMessage({action: 'show'});

    createDownloadLink();

    console.log('KonaJS: download\'em all!');
}

//create a download link
function createDownloadLink() {
    var child = document.getElementById('kona-download-link');

    if (child) {
        return;
    }

    //create the download link
    download_link = document.createElement('a');
    download_link.setAttribute('id', 'kona-download-link');
    download_link.style.visibility = 'hidden';
    //append link to document body
    document.body.appendChild(download_link);

    //create the error message element
    download_message_container = document.createElement("div");
    download_message_container.classList.add("kona-download-message-container");
    download_message_container.style.display = 'none';

    download_message = document.createElement('span');
    download_message.setAttribute('id', 'kona-download-message');

    download_message_container.appendChild(download_message);
    document.body.appendChild(download_message_container);
}

//displays an error message
function showError(message) {
    console.error('KonaJS: error:', message);
    showMessage('Download failed: ' + message);
    download_message.classList.add("error");
}

//displays a message
function showMessage(message) {
    download_message.innerHTML = message;
    download_message.classList.remove("error");
    download_message_container.style.display = '';

    //stop old timer
    if (download_message_timer) {
        window.clearTimeout(download_message_timer);
    }

    //set new timer to hide the message after N seconds
    download_message_timer = window.setTimeout(hideMessage, 5000);
}

//hides the message
function hideMessage() {
    download_message_container.style.display = 'none';
    download_message.innerHTML = '';

    //reset the timer
    if (download_message_timer) {
        window.clearTimeout(download_message_timer);
    }
}

//returns a meaningful message based on a FileError code
function getFileError(code) {
    var msg = '';

    switch (code) {
        case FileError.QUOTA_EXCEEDED_ERR:
            msg = 'quota exceeded';
            break;
        case FileError.NOT_FOUND_ERR:
            msg = 'file not found';
            break;
        case FileError.SECURITY_ERR:
            msg = 'security error';
            break;
        case FileError.INVALID_MODIFICATION_ERR:
            msg = 'invalid modification';
            break;
        case FileError.INVALID_STATE_ERR:
            msg = 'invalid state';
            break;
        default:
            msg = 'unknown error';
            break;
    }

    return msg;
}

function attach() {

    var container = getActiveProjectElement();
    if (!container) {
        console.error("KonaJS: No visible project container to attach to.");
        return;
    }

    //get the entry point element
    var entry = container.querySelector('.files .quick_view_options');
    if (!entry) {
        console.log("KonaJS: nothing to attach to on this page.");
        return;
    }

    var buttons = entry.querySelectorAll('button.kona-download-button');
    if (buttons && buttons.length) {
        return;
    }

    console.log("Attempting to attach to", entry);

    //attach to entry point
    attachToPage(entry);
}

function onMessageFromBackground(message, sender, sendResponse) {
    //skip invalid messages
    if (!message.action) {
        return
    }

    switch (message.action) {
        case 'attach': attach(); break;
        default: console.log('KonaJS: Message from background service:', message);
    }
}

chrome.runtime.onMessage.addListener(onMessageFromBackground);
