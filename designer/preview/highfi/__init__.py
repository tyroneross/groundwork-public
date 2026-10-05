"""High-fidelity preview renderers for the designer system.

High-fi fires only on dimensions where fidelity changes the pick:
color, depth/elevation, and motion. Each renderer returns a
self-contained, CSS-scoped HTML fragment safe for innerHTML injection
into a shared DOM.
"""
