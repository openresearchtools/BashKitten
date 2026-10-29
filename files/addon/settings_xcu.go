// Native Office user-settings storage adapter. The allowed roots mirror pinned
// Collabora DocumentBroker::getUploadableXcuPaths and LibreOffice's apply subset.
// This is XML data only: no external entities, includes, URLs or execution.
package main

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const registryNS = "http://openoffice.org/2001/registry"
const englishRulesPath = "/org.openoffice.Office.Linguistic/GrammarChecking/SentenceChecking/en"

var englishRuleDefaults = []string{"grammar", "cap", "dup", "pair", "spaces", "spaces2", "spaces3"}
var nativeXcuRoots = []string{
	"/org.openoffice.Office.Calc/Grid", "/org.openoffice.Office.Calc/Print",
	"/org.openoffice.Office.Calc/Content/Display/ObjectGraphic", "/org.openoffice.Office.Calc/Content/Display/FormulaMark",
	"/org.openoffice.Office.Draw/Grid", "/org.openoffice.Office.Draw/Print",
	"/org.openoffice.Office.Impress/Grid", "/org.openoffice.Office.Impress/Print",
	"/org.openoffice.Office.Writer/Grid", "/org.openoffice.Office.Writer/Print",
	"/org.openoffice.Office.Writer/Content/Display/GraphicObject", "/org.openoffice.Office.Writer/Content/Display/ShowBoundaries",
	"/org.openoffice.Office.Writer/Content/NonprintingCharacter", "/org.openoffice.Office.Common/BulletsNumbering",
	"/org.openoffice.Office.Common/I18N/CTL", "/org.openoffice.Office.Linguistic/GrammarChecking/SentenceChecking",
}

type xcuNode struct {
	name     xml.Name
	attrs    []xml.Attr
	text     string
	children []*xcuNode
}

func (n *xcuNode) attr(name string) string {
	for _, attr := range n.attrs {
		if attr.Name.Space == registryNS && attr.Name.Local == name {
			return attr.Value
		}
	}
	return ""
}
func nativeXcuPath(value string) bool {
	for _, root := range nativeXcuRoots {
		if value == root || strings.HasPrefix(value, root+"/") {
			return len(value) <= 4096 && !strings.Contains(value, "..") && !strings.Contains(value, "\\")
		}
	}
	return false
}
func nativeXcuContainer(value string) bool {
	if nativeXcuPath(value) {
		return true
	}
	if value == "" || len(value) > 4096 || strings.Contains(value, "..") || strings.Contains(value, "\\") {
		return false
	}
	for _, root := range nativeXcuRoots {
		if strings.HasPrefix(root, value+"/") {
			return true
		}
	}
	return false
}
func parseNativeXcu(content string) (*xcuNode, error) {
	if len(content) > 1<<20 {
		return nil, errors.New("native XCU exceeds 1 MiB")
	}
	if content == "" {
		return &xcuNode{name: xml.Name{Space: registryNS, Local: "items"}}, nil
	}
	decoder := xml.NewDecoder(strings.NewReader(content))
	var root *xcuNode
	var stack []*xcuNode
	count := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.Directive:
			return nil, errors.New("XCU declarations and entities are not accepted")
		case xml.ProcInst:
			if value.Target != "xml" {
				return nil, errors.New("XCU processing instructions are not accepted")
			}
		case xml.StartElement:
			count++
			if count > 32768 || len(stack) > 32 {
				return nil, errors.New("XCU structure exceeds its bound")
			}
			if len(stack) == 0 && (root != nil || value.Name.Space != registryNS || value.Name.Local != "items") {
				return nil, errors.New("native XCU needs one oor:items root")
			}
			if len(stack) > 0 && (value.Name.Space != "" || !strings.Contains("|item|node|prop|value|it|", "|"+value.Name.Local+"|")) {
				return nil, errors.New("unsupported native XCU element")
			}
			if len(stack) > 0 {
				parent := stack[len(stack)-1].name.Local
				valid := (parent == "items" && value.Name.Local == "item") ||
					((parent == "item" || parent == "node") && (value.Name.Local == "node" || value.Name.Local == "prop")) ||
					(parent == "prop" && value.Name.Local == "value") || (parent == "value" && value.Name.Local == "it")
				if !valid {
					return nil, errors.New("invalid native XCU hierarchy")
				}
			}
			node := &xcuNode{name: value.Name}
			for _, attr := range value.Attr {
				if attr.Name.Space == "xmlns" || (attr.Name.Space == "" && attr.Name.Local == "xmlns") {
					continue
				}
				if attr.Name.Space != "" && attr.Name.Space != registryNS && attr.Name.Space != "http://www.w3.org/2001/XMLSchema-instance" && attr.Name.Space != "http://www.w3.org/XML/1998/namespace" {
					return nil, errors.New("unsupported XCU attribute namespace")
				}
				node.attrs = append(node.attrs, attr)
			}
			if len(stack) == 1 && (node.name.Local != "item" || !nativeXcuContainer(node.attr("path"))) {
				return nil, errors.New("XCU path is outside native user settings")
			}
			// The pinned native producers use plain item containers and fuse
			// nodes. Do not silently reinterpret removal/finalization operations.
			if node.name.Local == "items" || node.name.Local == "item" || node.name.Local == "node" {
				for _, attr := range node.attrs {
					allowed := attr.Name.Space == registryNS && ((node.name.Local == "item" && attr.Name.Local == "path") || (node.name.Local == "node" && (attr.Name.Local == "name" || (attr.Name.Local == "op" && attr.Value == "fuse"))))
					if !allowed {
						return nil, errors.New("unsupported native XCU container operation")
					}
				}
			}
			if node.name.Local == "node" || node.name.Local == "prop" {
				name := node.attr("name")
				if name == "" || len(name) > 256 || strings.ContainsAny(name, "/\\\x00") || name == ".." {
					return nil, errors.New("invalid native XCU property")
				}
			}
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.children = append(parent.children, node)
			} else {
				root = node
			}
			stack = append(stack, node)
		case xml.EndElement:
			if len(stack) == 0 {
				return nil, errors.New("invalid native XCU closing element")
			}
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if len(stack) == 0 {
				if strings.TrimSpace(string(value)) != "" {
					return nil, errors.New("text outside XCU root")
				}
			} else {
				stack[len(stack)-1].text += string(value)
			}
		}
	}
	if root == nil || len(stack) != 0 {
		return nil, errors.New("incomplete native XCU")
	}
	return root, nil
}
func flattenNativeXcu(root *xcuNode) (*xcuNode, error) {
	result := &xcuNode{name: root.name}
	var visit func(*xcuNode, string) error
	visit = func(node *xcuNode, path string) error {
		item := &xcuNode{name: xml.Name{Local: "item"}, attrs: []xml.Attr{{Name: xml.Name{Space: registryNS, Local: "path"}, Value: path}}}
		for _, child := range node.children {
			if child.name.Local == "node" {
				if err := visit(child, path+"/"+child.attr("name")); err != nil {
					return err
				}
			} else {
				// Some native allowed entries identify a property, not its
				// parent item (e.g. Writer/Content/Display/ShowBoundaries).
				if !nativeXcuPath(path + "/" + child.attr("name")) {
					return errors.New("XCU property is outside native user settings")
				}
				item.children = append(item.children, child)
			}
		}
		if len(item.children) > 0 {
			result.children = append(result.children, item)
		}
		return nil
	}
	for _, item := range root.children {
		if err := visit(item, item.attr("path")); err != nil {
			return nil, err
		}
	}
	return result, nil
}
func xcuKey(n *xcuNode) string {
	if n.name.Local == "item" {
		return "item:" + n.attr("path")
	}
	return n.name.Local + ":" + n.attr("name")
}
func mergeXcuNode(current, incoming *xcuNode) {
	for _, added := range incoming.children {
		var existing *xcuNode
		for _, child := range current.children {
			if xcuKey(child) == xcuKey(added) {
				existing = child
				break
			}
		}
		if existing == nil {
			current.children = append(current.children, added)
		} else if added.name.Local == "prop" {
			*existing = *added
		} else {
			mergeXcuNode(existing, added)
		}
	}
}
func qualifiedXcuName(name xml.Name) string {
	switch name.Space {
	case registryNS:
		return "oor:" + name.Local
	case "http://www.w3.org/2001/XMLSchema-instance":
		return "xsi:" + name.Local
	case "http://www.w3.org/XML/1998/namespace":
		return "xml:" + name.Local
	}
	return name.Local
}
func writeXcuNode(out *bytes.Buffer, n *xcuNode) {
	out.WriteString("<" + qualifiedXcuName(n.name))
	if n.name.Local == "items" {
		out.WriteString(` xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`)
	}
	for _, attr := range n.attrs {
		out.WriteString(" " + qualifiedXcuName(attr.Name) + `="`)
		_ = xml.EscapeText(out, []byte(attr.Value))
		out.WriteString(`"`)
	}
	out.WriteString(">")
	if len(n.children) == 0 {
		_ = xml.EscapeText(out, []byte(n.text))
	} else {
		for _, child := range n.children {
			writeXcuNode(out, child)
		}
	}
	out.WriteString("</" + qualifiedXcuName(n.name) + ">")
}
func mergedNativeXcu(current, incoming string) (string, error) {
	first, err := parseNativeXcu(current)
	if err != nil {
		return "", fmt.Errorf("stored XCU: %w", err)
	}
	second, err := parseNativeXcu(incoming)
	if err != nil {
		return "", err
	}
	first, err = flattenNativeXcu(first)
	if err != nil {
		return "", err
	}
	second, err = flattenNativeXcu(second)
	if err != nil {
		return "", err
	}
	mergeXcuNode(first, second)
	// Normalize existing item/property duplicates through the same native fuse
	// semantics before filling only the seven deliberately selected missing flags.
	merged := &xcuNode{name: first.name}
	mergeXcuNode(merged, first)
	var english *xcuNode
	for _, item := range merged.children {
		if item.attr("path") == englishRulesPath {
			english = item
			break
		}
	}
	if english == nil {
		english = &xcuNode{name: xml.Name{Local: "item"}, attrs: []xml.Attr{{Name: xml.Name{Space: registryNS, Local: "path"}, Value: englishRulesPath}}}
		merged.children = append(merged.children, english)
	}
	for _, name := range englishRuleDefaults {
		present := false
		for _, prop := range english.children {
			if prop.attr("name") == name {
				present = true
				break
			}
		}
		if present {
			continue
		}
		english.children = append(english.children, &xcuNode{name: xml.Name{Local: "prop"}, attrs: []xml.Attr{{Name: xml.Name{Space: registryNS, Local: "name"}, Value: name}, {Name: xml.Name{Space: registryNS, Local: "op"}, Value: "fuse"}}, children: []*xcuNode{{name: xml.Name{Local: "value"}, text: "true"}}})
	}
	// Stable order makes stamps independent of unrelated input serialization.
	sort.SliceStable(merged.children, func(i, j int) bool { return merged.children[i].attr("path") < merged.children[j].attr("path") })
	out := bytes.NewBufferString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
	writeXcuNode(out, merged)
	out.WriteByte('\n')
	if out.Len() > 1<<20 {
		return "", errors.New("native XCU exceeds 1 MiB")
	}
	return out.String(), nil
}
