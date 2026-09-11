/**
 * Public website messenger widget. The ID is a client-side Intercom
 * workspace app_id (it ships in HTML). Do not confuse with Worker secrets.
 *
 * Vendor: Intercom Messenger (https://widget.intercom.io/widget/<app_id>).
 * Replaces the previous Chatbase embed, which 404'd until the agent was
 * public / domain-allowlisted.
 */

export const CHATBOT_EMBED_DOMAIN = 'widget.intercom.io';
export const INTERCOM_APP_ID_RE = /^[a-zA-Z0-9]{5,20}$/;

export function chatbotEmbedSnippet(widgetId?: string): string {
  const id = typeof widgetId === 'string' ? widgetId.trim() : '';
  if (!INTERCOM_APP_ID_RE.test(id)) return '';
  const jsonId = JSON.stringify(id);
  return `<script data-gc-chatbot="1">
window.intercomSettings={api_base:"https://api-iam.intercom.io",app_id:${jsonId}};
(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic("reattach_activator");ic("update",w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement("script");s.type="text/javascript";s.async=true;s.src="https://widget.intercom.io/widget/"+${jsonId};var x=d.getElementsByTagName("script")[0];x.parentNode.insertBefore(s,x);};if(document.readyState==="complete"){l();}else if(w.attachEvent){w.attachEvent("onload",l);}else{w.addEventListener("load",l,false);}}})();
</script>
<noscript>Chat widget requires JavaScript.</noscript>`;
}

/** Insert the widget once, immediately before </body>. */
export function withChatbotWidget(html: string, widgetId?: string): string {
  const snippet = chatbotEmbedSnippet(widgetId);
  if (!snippet) return html;
  if (html.includes('data-gc-chatbot="1"')) return html;
  const close = html.lastIndexOf('</body>');
  if (close === -1) return html + snippet;
  return html.slice(0, close) + snippet + html.slice(close);
}
