// xml.js – builds a Final Cut Pro 7 XML (xmeml) sequence that Premiere Pro can import.

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rateXml(fps) {
  return '<rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>';
}

// Position keyframes for one clip (Premiere's Motion > Position).
// keyframes: [{ frame, dx, dy }] – frame counted from the start of the clip, dx/dy in pixels from the still's normal place.
// EXPERIMENTAL: the unit of <horiz>/<vert> (assumed: fraction of the frame size) still has to be confirmed in Premiere.
function motionXml(keyframes, seq) {
  const keys = keyframes.map(k => `
                  <keyframe><when>${k.frame}</when><value><horiz>${(k.dx / seq.width).toFixed(5)}</horiz><vert>${(k.dy / seq.height).toFixed(5)}</vert></value></keyframe>`).join('');
  return `
            <filter>
              <effect>
                <name>Basic Motion</name>
                <effectid>basic</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter authoringApp="PremierePro">
                  <parameterid>center</parameterid>
                  <name>Center</name>${keys}
                </parameter>
              </effect>
            </filter>`;
}

// seq = {
//   name, fps, width, height, durationFrames,
//   tracks:  [ [ { fileName, start, end, keyframes (optional) }, … ], … ]   (frames; first track = V1)
//   markers: [ { name, frame }, … ]
// }
// The <pathurl> of each still is just its file name: Premiere then looks for it next to the XML file
// (tested in milestone 1), so the export folder can be moved or renamed freely.
function buildXmeml(seq) {
  const rate = rateXml(seq.fps);
  let clipNumber = 0;

  const tracksXml = seq.tracks.map(track => {
    const clipsXml = track.map(clip => {
      clipNumber++;
      const length = clip.end - clip.start;
      return `
          <clipitem id="clipitem-${clipNumber}">
            <name>${xmlEscape(clip.fileName)}</name>
            <enabled>TRUE</enabled>
            <duration>${length}</duration>
            ${rate}
            <start>${clip.start}</start>
            <end>${clip.end}</end>
            <in>0</in>
            <out>${length}</out>
            <alphatype>straight</alphatype>
            <stillframe>TRUE</stillframe>
            <file id="file-${clipNumber}">
              <name>${xmlEscape(clip.fileName)}</name>
              <pathurl>${xmlEscape(clip.fileName)}</pathurl>
              ${rate}
              <duration>${length}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${seq.width}</width>
                    <height>${seq.height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>${clip.keyframes ? motionXml(clip.keyframes, seq) : ''}
          </clipitem>`;
    }).join('');
    return `
        <track>${clipsXml}
        </track>`;
  }).join('');

  const markersXml = seq.markers.map(marker => `
    <marker>
      <name>${xmlEscape(marker.name)}</name>
      <comment></comment>
      <in>${marker.frame}</in>
      <out>-1</out>
    </marker>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xmlEscape(seq.name)}</name>
    <duration>${seq.durationFrames}</duration>
    ${rate}
    <timecode>
      ${rate}
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            ${rate}
            <width>${seq.width}</width>
            <height>${seq.height}</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
          </samplecharacteristics>
        </format>${tracksXml}
      </video>
    </media>${markersXml}
  </sequence>
</xmeml>
`;
}
